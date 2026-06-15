/**
 * Netlify Function: scan-roster
 * Two-pass AI roster analysis — works across ALL hospital roster formats.
 *
 * Pass 1 — Layout analysis: Claude describes the roster structure
 * Pass 2 — Duty extraction: Claude extracts duties for the SPECIFIC named doctor
 *
 * Full name matching is used to avoid confusion when multiple doctors share a surname.
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

// Strip "Dr." / "Prof." / "Mr." / "Mrs." / "Ms." prefixes and return name parts
function parseName(fullName) {
  const stripped = fullName.replace(/^(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '').trim()
  const parts = stripped.split(/\s+/)
  const lastName = parts[parts.length - 1].toUpperCase()
  const firstName = parts[0].toUpperCase()
  const firstInitial = firstName[0]
  return { firstName, lastName, firstInitial, stripped }
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

  const { imageBase64, mediaType, month, year, fullName, hospital } = body
  if (!imageBase64 || !mediaType || month === undefined || !year || !fullName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) }
  }

  const { firstName, lastName, firstInitial, stripped: cleanName } = parseName(fullName)
  const isCMC = (hospital || '').toLowerCase().includes('caballero')

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
          text: `This is a hospital duty roster for ${MONTHS[month]} ${year}${hospital ? ` from ${hospital}` : ''}.

We are looking for duties assigned to: "${cleanName}" (first name: ${firstName}, last name: ${lastName}, first initial: ${firstInitial}).

IMPORTANT — name uniqueness: There may be multiple staff members with the surname "${lastName}". We need duties for "${cleanName}" ONLY — not any other person who shares that surname.

Analyse this roster and answer ALL of the following questions:

1. LAYOUT TYPE — which of these best describes this roster?
   A) CALENDAR GRID: a monthly calendar grid (days of week as columns), each date cell contains the name(s) of staff assigned to work that day.
   B) DUTY TABLE: a table where rows = dates, columns = different duty types or time periods (e.g. daytime vs overnight, or different wards/roles).
   C) STAFF ROWS: a table where rows = staff members, columns = dates (each cell shows if that staff member works that day).
   D) OTHER: describe it.

2. How are staff names written in this roster? (e.g. SURNAME only, First Last, Last First, SURNAME Initial, paired as "Name1/Name2", with "Dr." prefix, etc.)

3. If DUTY TABLE: which column or section contains the on-call / overnight / rostered duties (vs daytime)?

4. Does "${lastName}" appear in this roster? If yes, are there multiple different people with that surname? How can they be told apart (e.g. different first name, initial, or position)?

5. Go through the roster SYSTEMATICALLY — week by week for a calendar grid, or row by row for a table — and list EVERY date where "${cleanName}" (specifically) appears. Write out each date explicitly, e.g. "Feb 1, Feb 3, Feb 10, Feb 12, Feb 20, Feb 27". Count them.

Be precise. This analysis is used to verify the extraction in the next step.`,
        },
      ],
    }], 1200)

    console.log('Layout analysis:', layoutAnalysis)

    // ── PASS 2: Extract duties using layout knowledge ────────────────────────
    const calendar = buildCalendar(year, month)

    const typeRules = isCMC
      ? `DUTY TYPE: This is a Caballero Medical Center (CMC) day rota. Use typeId "cmc_day" for every shift found.`
      : `DUTY TYPE — classify each duty using the correct typeId:
- Monday–Friday overnight/on-call → "weekday"
- Saturday overnight/on-call → "saturday"
- Sunday overnight/on-call → "holiday"
- Public Holiday overnight/on-call → "holiday"
- Weekday casualty session (4hr block) → "casualty_weekday"
- Saturday casualty session → "casualty_saturday"
- Sunday/Holiday casualty session → "casualty_holiday"
- Weekday ward round (4hr block) → "ward_weekday"
- Saturday ward round → "ward_saturday"
- Sunday/Holiday ward round → "ward_holiday"`

    const extractionResult = await callClaude(CLAUDE_API_KEY, [
      {
        role: 'user',
        content: [
          imageContent,
          {
            type: 'text',
            text: `This is a hospital duty roster for ${MONTHS[month]} ${year}${hospital ? ` from ${hospital}` : ''}.

TARGET DOCTOR: "${cleanName}"
- First name: ${firstName}
- Last name: ${lastName}
- First initial: ${firstInitial}

⚠️ NAME CONFLICT WARNING: If there are multiple staff members with the surname "${lastName}", you MUST distinguish between them using their first name or initial. Only extract duties for "${cleanName}" — ignore any other person named "${lastName}".

ROSTER LAYOUT (from prior analysis):
${layoutAnalysis}

EXTRACTION RULES based on layout:
- CALENDAR GRID: go week by week (each row of the grid), check EVERY cell in EVERY row. Extract every date where "${cleanName}"'s name appears.
- DUTY TABLE: go row by row through every date. Extract only from the on-call/overnight column — ignore daytime column.
- STAFF ROWS: find the row for "${cleanName}" and extract every date where they are scheduled.
- A cell matches if it contains "${lastName}" AND matches "${firstName}" or initial "${firstInitial}" (when names are distinguished). If only one "${lastName}" exists in the roster, any appearance counts.
- If "${cleanName}" is not found at all: return {"notFound": true}

⚠️ VERIFICATION: The prior analysis explicitly listed every date for "${cleanName}". Your JSON array MUST include ALL of those dates — do not omit any. If your count is lower than what the prior analysis found, re-examine those weeks.

CALENDAR — use this to map day numbers to exact dates and day of week:
${calendar}

${typeRules}

Return a JSON array of duties:
[{"date":"${year}-${m}-01","typeId":"weekday"},{"date":"${year}-${m}-07","typeId":"saturday"},...]

Return ONLY the JSON array. No explanation, no markdown.`,
          },
        ],
      },
      {
        role: 'assistant',
        content: 'I have checked every date in the roster for the specific doctor requested. Here is the complete list:',
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
        layoutAnalysis,
      }),
    }

  } catch (err) {
    console.error('Scan error:', err)
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message }) }
  }
}
