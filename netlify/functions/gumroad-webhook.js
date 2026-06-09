/**
 * Netlify Function: gumroad-webhook
 * Receives Gumroad sale/cancellation events and updates user subscription in Firestore.
 *
 * Events handled:
 *  - sale / subscription_restarted  → subscription: 'pro'
 *  - refund / cancellation / subscription_ended → subscription: 'trial'
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

function initAdmin() {
  if (getApps().length > 0) return
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  initializeApp({ credential: cert(sa) })
}

function parseFormBody(raw) {
  const params = new URLSearchParams(raw)
  const obj = {}
  for (const [k, v] of params.entries()) obj[k] = v
  return obj
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  let data
  try {
    // Gumroad sends application/x-www-form-urlencoded
    data = parseFormBody(event.body)
  } catch (err) {
    return { statusCode: 400, body: 'Invalid body' }
  }

  const { email, type, test } = data

  // Ignore test pings from Gumroad dashboard
  if (test === 'true') {
    console.log('Gumroad test ping received — ignoring')
    return { statusCode: 200, body: 'ok (test)' }
  }

  if (!email) {
    console.error('No email in Gumroad payload')
    return { statusCode: 400, body: 'Missing email' }
  }

  // Determine new subscription status based on event type
  const PRO_EVENTS = ['sale', 'subscription_restarted']
  const TRIAL_EVENTS = ['refund', 'cancellation', 'subscription_ended']

  let newStatus = null
  if (!type || PRO_EVENTS.includes(type)) newStatus = 'pro'
  else if (TRIAL_EVENTS.includes(type)) newStatus = 'trial'
  else {
    console.log(`Unhandled Gumroad event type: ${type} — ignoring`)
    return { statusCode: 200, body: 'ok (ignored)' }
  }

  try {
    initAdmin()
    const db = getFirestore()

    // Find user by email
    const snap = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get()

    if (snap.empty) {
      console.warn(`Gumroad webhook: no user found for email ${email}`)
      // Still return 200 so Gumroad doesn't keep retrying
      return { statusCode: 200, body: 'user not found' }
    }

    const userDoc = snap.docs[0]
    await userDoc.ref.update({
      subscription: newStatus,
      subscriptionUpdatedAt: new Date().toISOString(),
    })

    console.log(`Updated ${email} → subscription: ${newStatus} (event: ${type || 'sale'})`)
    return { statusCode: 200, body: 'ok' }

  } catch (err) {
    console.error('Firestore error:', err)
    return { statusCode: 500, body: 'Internal error' }
  }
}
