/**
 * Netlify Function: send-welcome-email
 * Sends a welcome email via Resend after a user signs up.
 * Called from the client after Firebase registration succeeds.
 */

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

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const { name, email } = body
  if (!name || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing name or email' }) }
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY
  if (!RESEND_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured (RESEND_API_KEY missing)' }) }
  }

  // ── 3. Send welcome email via Resend ──────────────────────────────────────
  const firstName = name.split(' ')[0]

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ClaimDesk</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">📊 ClaimDesk</p>
              <p style="margin:8px 0 0;font-size:14px;color:#bfdbfe;">Your salary claim calculator</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">
                Welcome, ${firstName}! 🎉
              </h1>
              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
                Your ClaimDesk account is ready. You can now log and track your on-call duties to generate accurate salary claim sheets — no more manual calculations.
              </p>

              <table width="100%" style="background:#eff6ff;border-radius:12px;padding:20px;margin-bottom:24px;" cellpadding="0" cellspacing="0">
                <tr><td style="padding:6px 0;">
                  <p style="margin:0;font-size:14px;color:#1e40af;">
                    ✅ &nbsp;<strong>Log duties</strong> on the calendar
                  </p>
                </td></tr>
                <tr><td style="padding:6px 0;">
                  <p style="margin:0;font-size:14px;color:#1e40af;">
                    📄 &nbsp;<strong>Export PDF &amp; Excel</strong> claim sheets
                  </p>
                </td></tr>
                <tr><td style="padding:6px 0;">
                  <p style="margin:0;font-size:14px;color:#1e40af;">
                    🤖 &nbsp;<strong>AI roster scan</strong> — upload your roster image
                  </p>
                </td></tr>
              </table>

              <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
                Head to your dashboard to get started. If you have any questions, just reply to this email.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2563eb;border-radius:10px;">
                    <a href="https://claimdeskja.app/dashboard"
                       style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Go to my dashboard →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                ClaimDesk · Built for Jamaican healthcare workers<br />
                You received this because you created an account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'ClaimDesk <onboarding@resend.dev>',
      to: [email],
      subject: `Welcome to ClaimDesk, ${firstName}!`,
      html,
    }),
  })

  if (!resendRes.ok) {
    const errText = await resendRes.text()
    console.error('Resend error:', resendRes.status, errText)
    // Don't fail the whole signup — email is non-critical
    return { statusCode: 200, headers, body: JSON.stringify({ sent: false, error: errText }) }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ sent: true }) }
}
