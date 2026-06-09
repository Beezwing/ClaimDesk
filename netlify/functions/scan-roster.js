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
            text: `This is a hospital duty roster for ${MONTHS[month]} ${year}.

Your task: find ALL rostered overnight duties assigned to "${fullName}" (last name: "${lastName}").

── WHAT IS A ROSTERED DUTY ──
A rostered duty is an overnight on-call shift from 4PM to 8AM (16 hours).
The duty is identified by the DATE IT STARTS (the evening date, not the morning).
For example: a duty starting Saturday 4PM and ending Sunday 8AM → date is the Saturday, typeId = "saturday".

── CALENDAR FOR ${MONTHS[month]} ${year} ──
Use this exact calendar to determine the day of week for every date:
${buildCalendar(year, month)}

── HOW TO READ THE ROSTER ──
Rosters vary in layout. The person's name may appear as:
- A ROW label (their duties are marked across columns for each date)
- A COLUMN entry (their name appears in a date's cell)
Look carefully at both patterns across the ENTIRE image.

── STEP 1: FIND THE NAME ──
Scan every row and column for "${lastName}" or "${fullName}" in any format (ALL CAPS, initials, abbreviated).
If the name does NOT appear anywhere, return exactly: {"notFound": true}

── STEP 2: EXTRACT ALL DUTIES ──
For each date where this person is rostered for an overnight duty, determine the typeId using the calendar above:

- Duty starts Monday–Friday → "weekday"
- Duty starts Saturday → "saturday"  (this is "Day Off 1" rate)
- Duty starts Sunday or Public Holiday → "holiday"  (this is "Day Off 2" rate)

Ward round sessions (4-hour blocks):
- Weekday ward round → "ward_weekday"
- Saturday ward round → "ward_saturday"
- Sunday/Holiday ward round → "ward_holiday"

Casualty sessions (4-hour blocks):
- Weekday casualty → "casualty_weekday"
- Saturday casualty → "casualty_saturday"
- Sunday/Holiday casualty → "casualty_holiday"

── OUTPUT ──
Return a JSON array of every duty found:
[{"date":"${year}-${m}-03","typeId":"weekday"},{"date":"${year}-${m}-08","typeId":"saturday"},...]

IMPORTANT: Scan the ENTIRE roster — do not stop early. A doctor may have 15–25 duties in a month.
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
