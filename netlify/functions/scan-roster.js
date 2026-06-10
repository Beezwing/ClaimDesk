/**
 * Netlify Function: scan-roster
 * Secure proxy to Anthropic Claude for roster image analysis.
 * - Verifies Firebase ID token before calling Claude
 * - CLAUDE_API_KEY never leaves the server
 */

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// Build a calendar map for a given month/year: { "2024-06-01": "Saturday", ... }
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

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // ── 1. Verify Firebase ID token ───────────────────────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!idToken) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing auth token' }) }
  }

  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY
  if (!FIREBASE_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured (FIREBASE_API_KEY missing)' }) }
  }

  const verifyRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  )

  if (!verifyRes.ok) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) }
  }

  // ── 2. Parse request body ─────────────────────────────────────────────────
  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const { imageBase64, mediaType, month, year, fullName, lastName } = body

  if (!imageBase64 || !mediaType || month === undefined || !year || !fullName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) }
  }

  const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY
  if (!CLAUDE_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured (CLAUDE_API_KEY missing)' }) }
  }

  // ── 3. Call Claude ────────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0')
  const m = pad(month + 1)

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `This is a hospital department duty roster for ${MONTHS[month]} ${year}.

── ROSTER LAYOUT ──
This roster has TWO sections side by side:
1. LEFT section "8am - 4pm": Lists all doctors on daytime duty. IGNORE THIS SECTION COMPLETELY.
2. RIGHT section "4pm - 8am ROSTERED DUTY": Has sub-columns (SHO / MOs/Residents / SR/Consultant). THIS IS THE ONLY SECTION THAT MATTERS.

Your task: Find every row where "${lastName}" or "${fullName}" appears in the RIGHT "4pm - 8am ROSTERED DUTY" columns ONLY.
Each cell in the right section may contain multiple names separated by "/" (e.g. "Muirhead/Prendergast") — if "${lastName}" appears anywhere in the cell, that is a rostered duty for this person.

── STEP 1: FIND THE NAME ──
Scan ONLY the right-side "4pm - 8am" columns for "${lastName}".
IGNORE any appearance of the name in the left "8am - 4pm" daytime column.
If "${lastName}" does not appear in the right section at all, return exactly: {"notFound": true}

── STEP 2: EXTRACT ALL DUTIES ──
For each row where "${lastName}" appears in the right section, record the date from that row.
Use this exact calendar to determine the day of week:
${buildCalendar(year, month)}

Classify each duty using these typeId rules:
- Monday–Friday overnight (4PM–8AM) → "weekday"
- Saturday overnight → "saturday"
- Sunday overnight → "holiday"
- Public Holiday overnight → "holiday"
- Weekday casualty session (4hr) → "casualty_weekday"
- Saturday casualty session → "casualty_saturday"
- Sunday/Holiday casualty session → "casualty_holiday"
- Weekday ward round (4hr) → "ward_weekday"
- Saturday ward round → "ward_saturday"
- Sunday/Holiday ward round → "ward_holiday"

── OUTPUT ──
Return a JSON array of ALL duties found in the right section:
[{"date":"${year}-${m}-03","typeId":"weekday"},{"date":"${year}-${m}-19","typeId":"saturday"},...]

Be thorough — check every single row of the right section. Do NOT stop early.
Return ONLY the JSON array (or {"notFound":true}) — no explanation, no markdown fences.`,
          },
        ],
      }],
    }),
  })

  if (!claudeRes.ok) {
    const errText = await claudeRes.text()
    console.error('Claude API error:', claudeRes.status, errText)
    return { statusCode: 502, headers, body: JSON.stringify({ error: `Claude API error: ${claudeRes.status} — ${errText}` }) }
  }

  const claudeData = await claudeRes.json()
  return { statusCode: 200, headers, body: JSON.stringify(claudeData) }
}
