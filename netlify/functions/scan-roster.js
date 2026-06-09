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

Your task: find ALL duties assigned to "${fullName}" (last name: "${lastName}") and return them as a JSON array.

Step 1 — Find the name.
Scan the ENTIRE image carefully — every row, every column, every cell. Look for "${lastName}" or "${fullName}" in any format (e.g. ALL CAPS, with initials, abbreviated). If the name does NOT appear anywhere at all, return exactly:
{"notFound": true}

Step 2 — Extract ALL duties.
Hospital rosters vary in format. The person's name may appear as a ROW heading (duties are columns/dates in that row) OR as a COLUMN entry (duties are marked in their row for each date). Look for BOTH patterns.

A "duty" is any cell where this person is assigned — this includes:
- Overnight on-call (4PM–8AM) — marked as OC, On-call, overnight, or their name in a date cell
- Ward rounds / ward sessions (4-hour blocks)
- Casualty sessions (4-hour blocks)
- Any other shift assignment

For EVERY duty found, determine the date and classify the typeId:

typeId rules (use the day of week for that date in ${MONTHS[month]} ${year}):
- Monday–Friday overnight = "weekday"
- Saturday overnight = "saturday"
- Sunday or Public Holiday overnight = "holiday"
- Ward round weekday = "ward_weekday", Saturday = "ward_saturday", Sunday/Holiday = "ward_holiday"
- Casualty weekday = "casualty_weekday", Saturday = "casualty_saturday", Sunday/Holiday = "casualty_holiday"

Return a JSON array of ALL duties found:
[{"date":"${year}-${m}-03","typeId":"weekday"},{"date":"${year}-${m}-07","typeId":"saturday"},...]

IMPORTANT: Be thorough. Do not stop after finding a few — scan the ENTIRE roster for every occurrence of this person's name. A busy doctor may have 15–25 duties in a month.

Return ONLY the JSON array (or {"notFound":true}) — no explanation, no markdown.`,
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
