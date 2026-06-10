/**
 * Netlify Function: scan-roster
 * Two-pass AI roster analysis for maximum accuracy across all roster formats.
 *
 * Pass 1 — Layout analysis: Claude describes the roster structure
 * Pass 2 — Duty extraction: Claude extracts duties using the layout it just described
 */

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function buildCalendar(year, month) {
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const lines = []
  for (let d = 1; d <= daysInMonth; d++) {
    const pad = n => String(n).padStart(2, '0')
    const date = `${year}-${pad(month + 1)}-${pad(d)}`
    const dayName = DAY_NAMES[new Date(year, month, d).getDay()]
    lines.push(`${date} = ${dayName}`)
  }
  return lines.join('\n')
}

async function callClaude(apiKey, messages, maxTokens = 1024) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      messages,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API ${res.status}: ${err}`)
  }
  const data = await res.json()
  return data.content?.[0]?.text?.trim() || ''
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!idToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing auth token' }) }

  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY
  if (!FIREBASE_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) }

  const verifyRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
  )
  if (!verifyRes.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body
  try { body = JSON.parse(event.body) }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) } }

  const { imageBase64, mediaType, month, year, fullName, lastName } = body
  if (!imageBase64 || !mediaType || month === undefined || !year || !fullName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) }
  }

  const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY
  if (!CLAUDE_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) }

  const pad = n => String(n).padStart(2, '0')
  const m = pad(month + 1)
  const imageContent = { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } }

  try {
    // ── PASS 1: Analyse roster layout ────────────────────────────────────────
    const layoutAnalysis = await callClaude(CLAUDE_API_KEY, [{
      role: 'user',
      content: [
        imageContent,
        {
          type: 'text',
          text: `This is a hospital duty roster for ${MONTHS[month]} ${year}.

Analyse this roster and answer ALL of the following questions clearly and concisely:

1. What is the overall layout? (e.g. rows = dates/days, columns = staff names OR rows = staff names, columns = dates)
2. Are there separate sections for DAYTIME duties and OVERNIGHT/ON-CALL duties? If yes, describe where each section is (left/right, top/bottom, column headings).
3. What column heading or label identifies the OVERNIGHT or ON-CALL section? (e.g. "4pm-8am", "On Call", "Rostered Duty", "Night Duty")
4. How are staff names written in this roster? (e.g. SURNAME only, First Last, paired as "Name1/Name2")
5. Does the name "${lastName}" or "${fullName}" appear anywhere in the roster? If yes, in which section(s)?
6. How many times does "${lastName}" appear in the overnight/on-call section specifically?

Be specific and accurate. This analysis will be used to extract duties in the next step.`,
        },
      ],
    }], 1024)

    console.log('Layout analysis:', layoutAnalysis)

    // ── PASS 2: Extract duties using layout knowledge ────────────────────────
    const calendar = buildCalendar(year, month)

    const extractionResult = await callClaude(CLAUDE_API_KEY, [
      {
        role: 'user',
        content: [
          imageContent,
          {
            type: 'text',
            text: `This is a hospital duty roster for ${MONTHS[month]} ${year}.

A previous analysis of this roster found:
${layoutAnalysis}

Now extract ALL overnight/on-call rostered duties for "${fullName}" (last name: "${lastName}").

RULES:
- ONLY extract duties from the OVERNIGHT / ON-CALL section (NOT daytime duties)
- A cell counts as a duty for "${lastName}" if their name appears anywhere in it (including paired names like "Smith/Jones")
- Go through EVERY row in the overnight section — do not skip any
- If "${lastName}" does not appear in the overnight section at all, return: {"notFound": true}

CALENDAR (use this to determine day of week for each date):
${calendar}

CLASSIFY each duty with the correct typeId:
- Monday to Friday overnight → "weekday"
- Saturday overnight → "saturday"
- Sunday overnight → "holiday"
- Public Holiday overnight → "holiday"
- Weekday casualty session (4hr block) → "casualty_weekday"
- Saturday casualty session → "casualty_saturday"
- Sunday/Holiday casualty session → "casualty_holiday"
- Weekday ward round (4hr block) → "ward_weekday"
- Saturday ward round → "ward_saturday"
- Sunday/Holiday ward round → "ward_holiday"

Return a JSON array of every duty found:
[{"date":"${year}-${m}-03","typeId":"weekday"},{"date":"${year}-${m}-19","typeId":"saturday"},...]

IMPORTANT: Be exhaustive. Check every single row. Do NOT stop early.
Return ONLY the JSON (no explanation, no markdown).`,
          },
        ],
      },
      {
        role: 'assistant',
        content: 'I have carefully reviewed every row of the overnight section. Here is the complete list:',
      },
    ], 4096)

    console.log('Extraction result:', extractionResult)

    // ── Parse result ─────────────────────────────────────────────────────────
    if (extractionResult.includes('"notFound"')) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ content: [{ text: JSON.stringify({ notFound: true }) }] }),
      }
    }

    const jsonMatch = extractionResult.match(/\[[\s\S]*\]/)
    const duties = jsonMatch ? JSON.parse(jsonMatch[0]) : []

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        content: [{ text: JSON.stringify(duties) }],
        layoutAnalysis, // pass back for debugging
      }),
    }

  } catch (err) {
    console.error('Scan error:', err)
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message }) }
  }
}
