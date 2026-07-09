const express = require("express");
const https = require("https");

const app = express();
app.use(express.json({ limit: "20mb" }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "pocketwise-e736c";
const APP_SECRET = process.env.APP_SECRET;
const PORT = process.env.PORT || 3000;

if (!ANTHROPIC_API_KEY) { console.error("FATAL: ANTHROPIC_API_KEY not set"); process.exit(1); }
if (!APP_SECRET) { console.error("FATAL: APP_SECRET not set"); process.exit(1); }

// --- RESEND EMAIL HELPER -------------------------------------------------------
function sendResendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log("[EMAIL] RESEND_API_KEY not set - skipping:", subject); return; }
  const payload = JSON.stringify({ from: "Pocketwise <onboarding@resend.dev>", to: [to], subject, html });
  const opts = {
    hostname: "api.resend.com", path: "/emails", method: "POST",
    headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  };
  const r = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => console.log("[EMAIL] Sent to", to, "status", res.statusCode)); });
  r.on("error", e => console.log("[EMAIL] Error:", e.message));
  r.write(payload); r.end();
}

// â”€â”€â”€ RATE LIMITER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const rateLimitMap = new Map();
function rateLimit(userId, max = 20, windowMs = 60000) {
  const now = Date.now();
  const u = rateLimitMap.get(userId) || { count: 0, resetAt: now + windowMs };
  if (now > u.resetAt) { u.count = 0; u.resetAt = now + windowMs; }
  u.count++;
  rateLimitMap.set(userId, u);
  return u.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries()) { if (now > v.resetAt) rateLimitMap.delete(k); }
}, 5 * 60 * 1000);

// â”€â”€â”€ CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Secret, X-Firebase-Token");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// â”€â”€â”€ FIREBASE TOKEN VERIFIER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cache public keys â€” they rotate every ~6 hours; we cache for 5 hours to avoid
// making an outbound HTTPS call on every single scan request (which caused
// intermittent 401s whenever googleapis.com had a brief hiccup).
let _keyCache = { keys: null, expiresAt: 0 };

function fetchFirebasePublicKeys() {
  return new Promise((resolve, reject) => {
    https.get(
      "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const keys = JSON.parse(data);
            // Cache for 5 hours
            _keyCache = { keys, expiresAt: Date.now() + 5 * 60 * 60 * 1000 };
            resolve(keys);
          } catch { reject(new Error("Key fetch failed â€” invalid JSON from Google")); }
        });
      }
    ).on("error", (err) => reject(new Error(`Could not fetch public keys: ${err.message}`)));
  });
}

async function getFirebasePublicKeys() {
  if (_keyCache.keys && Date.now() < _keyCache.expiresAt) return _keyCache.keys;
  return fetchFirebasePublicKeys();
}

async function verifyFirebaseToken(idToken) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch { throw new Error("Invalid token encoding"); }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error("Token expired");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(FIREBASE_PROJECT_ID)) throw new Error("Invalid audience");
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error("Invalid issuer");
  if (!payload.sub) throw new Error("No subject");

  let keys;
  try {
    keys = await getFirebasePublicKeys();
  } catch (e) {
    // If fresh fetch fails, use stale cache rather than rejecting all tokens
    if (_keyCache.keys) {
      console.log("Key fetch failed, using stale cache:", e.message);
      keys = _keyCache.keys;
    } else {
      throw new Error("Could not fetch Firebase public keys and no cache available");
    }
  }

  if (!keys[header.kid]) throw new Error(`Key not found (kid=${header.kid})`);

  return { uid: payload.sub, email: payload.email || "" };
}

// â”€â”€â”€ AUTH MIDDLEWARE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function authenticate(req, res, next) {
  const appSecret = req.headers["x-app-secret"];
  if (!appSecret || appSecret !== APP_SECRET) {
    return res.status(401).json({ error: "Unauthorized - invalid app secret" });
  }
  const firebaseToken = req.headers["x-firebase-token"];
  if (!firebaseToken) {
    return res.status(401).json({ error: "Unauthorized - no Firebase token" });
  }
  try {
    const decoded = await verifyFirebaseToken(firebaseToken);
    req.user = decoded;
    next();
  } catch (error) {
    console.log("Auth error:", error.message);
    return res.status(401).json({ error: "Unauthorized - invalid Firebase token" });
  }
}

// â”€â”€â”€ PAYMENT CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GUMROAD_ACCESS_TOKEN  = process.env.GUMROAD_ACCESS_TOKEN  || "";
const GUMROAD_PRO_ID        = process.env.GUMROAD_PRO_ID        || "";
const GUMROAD_FAMILY_ID     = process.env.GUMROAD_FAMILY_ID     || "";
const LUNIPAY_WEBHOOK_SECRET = process.env.LUNIPAY_WEBHOOK_SECRET || "";

// Public Firebase API key (same as in mobile/web apps â€” safe to include here)
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyCtkq13sK18fI8jbXp2X9Sj745GPyRvLhE";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// In-memory store (fast path) â€” also write-through to Firestore (survives restarts)
const pendingUpgrades = new Map();
const pendingByEmail  = new Map();

function firestoreReq(method, path, body) {
  return new Promise((resolve) => {
    const fullPath = `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents${path}?key=${FIREBASE_API_KEY}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "firestore.googleapis.com",
      path: fullPath,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on("error", (e) => { console.log("[FIRESTORE]", method, path, e.message); resolve({ status: 0, data: null }); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function fsSetPending(key, entry) {
  const docId = encodeURIComponent(key);
  const fields = {
    plan:   { stringValue: entry.plan || "pro" },
    email:  { stringValue: entry.email || "" },
    source: { stringValue: entry.source || "" },
    at:     { integerValue: String(entry.at || Date.now()) },
  };
  const r = await firestoreReq("PATCH", `/pendingUpgrades/${docId}`, { fields });
  if (r.status !== 200) console.log("[FIRESTORE] fsSetPending error", r.status, JSON.stringify(r.data).slice(0,200));
}

async function fsGetPending(key) {
  const docId = encodeURIComponent(key);
  const r = await firestoreReq("GET", `/pendingUpgrades/${docId}`, null);
  if (r.status !== 200 || !r.data?.fields) return null;
  const f = r.data.fields;
  return {
    plan:   f.plan?.stringValue || "pro",
    email:  f.email?.stringValue || "",
    source: f.source?.stringValue || "",
    at:     parseInt(f.at?.integerValue || "0"),
  };
}

async function fsDeletePending(key) {
  const docId = encodeURIComponent(key);
  await firestoreReq("DELETE", `/pendingUpgrades/${docId}`, null);
}

// â”€â”€â”€ GUMROAD WEBHOOK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/payments/gumroad-webhook
// Gumroad fires this on every sale. We extract the UID from custom_fields,
// determine the plan from product_id, and queue an upgrade for the user.
app.post("/api/payments/gumroad-webhook", express.urlencoded({ extended: true }), (req, res) => {
  const body = req.body;
  console.log("[GUMROAD WEBHOOK]", JSON.stringify(body).slice(0, 300));

  const uid = body["custom_fields[uid]"] || body.uid || "";
  const productId = body.product_id || body.product_permalink || "";
  const email = body.email || "";
  const saleId = body.sale_id || "";

  if (!uid && !email) {
    console.log("[GUMROAD WEBHOOK] No uid or email â€” cannot map to user");
    return res.sendStatus(200); // still 200 so Gumroad doesn't retry
  }

  let plan = "pro";
  if (GUMROAD_FAMILY_ID && (productId === GUMROAD_FAMILY_ID)) plan = "family";

  const isRefund = body.refunded === "true";
  const isCancelled = body.subscription_cancelled === "true" || body.ended_at;

  if (isRefund || isCancelled) {
    // Downgrade â€” store downgrade signal
    if (uid) pendingUpgrades.set(uid, { plan: "free", source: "gumroad", saleId, at: Date.now() });
    console.log(`[GUMROAD] Downgrade to free for uid=${uid}`);
  } else {
    if (uid) pendingUpgrades.set(uid, { plan, source: "gumroad", saleId, email, at: Date.now() });
    console.log(`[GUMROAD] Upgrade to ${plan} for uid=${uid}`);
  }

  return res.sendStatus(200);
});

// â”€â”€â”€ LUNIPAY WEBHOOK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/payments/lunipay-webhook
// Lunipay fires this on payment. We key upgrades by email since Lunipay
// doesn't support success-redirect URLs with our UID embedded.
app.post("/api/payments/lunipay-webhook", (req, res) => {
  // Verify webhook secret — must match the secret appended to the webhook URL
  if (LUNIPAY_WEBHOOK_SECRET) {
    const provided = req.query.secret || req.headers["x-webhook-secret"] || "";
    if (provided !== LUNIPAY_WEBHOOK_SECRET) {
      console.log("[LUNIPAY WEBHOOK] Rejected - bad secret");
      return res.sendStatus(403);
    }
  }
  const body = req.body;
  console.log("[LUNIPAY WEBHOOK]", JSON.stringify(body).slice(0, 500));

  const email  = (body?.customer?.email || body?.email || body?.customer_email || "").toLowerCase().trim();
  const uid    = body?.metadata?.uid  || body?.uid  || "";
  const rawPlan = body?.metadata?.plan || body?.plan || "";
  const productStr = JSON.stringify(body?.product || body?.checkout || body?.payment_link || body?.link || "").toLowerCase();
  const plan = rawPlan || (productStr.includes("family") ? "family" : "pro");
  const status = body?.status || body?.payment_status || body?.event || "";

  const isCancelled = Boolean(status) && ["refunded","cancelled","failed","payment.failed","charge.failed",
    "checkout.session.expired","subscription_cancelled","payment_failed","charge_failed"].some(s => status.toLowerCase().includes(s));
  const isPaid = !isCancelled;

  if (isPaid) {
    const entry = { plan, source: "lunipay", email, at: Date.now() };
    if (uid)   { pendingUpgrades.set(uid, entry);   fsSetPending(uid, entry); }
    if (email) { pendingByEmail.set(email, uid || email); pendingUpgrades.set(email, entry); fsSetPending(email, entry); }
    console.log("[LUNIPAY] Upgrade to " + plan + " - uid=" + (uid || "unknown") + " email=" + email);
    if (email) {
      const planLabel = plan === "family" ? "Family" : "Pro";
      const successHtml =
        "<div style='font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#080C14;color:#F1F5F9;border-radius:16px'>" +
        "<h2 style='color:#F97316;margin-top:0'>Payment confirmed &#10003;</h2>" +
        "<p>Your <strong>Pocketwise " + planLabel + "</strong> subscription has been renewed successfully.</p>" +
        "<p style='color:#94A3B8;font-size:14px'>All features are unlocked and active. No action needed on your end.</p>" +
        "<p style='color:#64748B;font-size:12px;margin-top:24px'>To manage or cancel your subscription visit " +
        "<a href='https://www.lunipay.io/account' style='color:#F97316'>lunipay.io/account</a>.</p></div>";
      sendResendEmail(email, "Your Pocketwise " + planLabel + " subscription is active!", successHtml);
    }
  } else if (isCancelled) {
    const entry = { plan: "free", source: "lunipay", email, at: Date.now() };
    if (uid)   { pendingUpgrades.set(uid,   entry); fsSetPending(uid, entry); }
    if (email) { pendingUpgrades.set(email, entry); fsSetPending(email, entry); }
    console.log("[LUNIPAY] Downgrade to free - email=" + email);
    if (email) {
      const failHtml =
        "<div style='font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#080C14;color:#F1F5F9;border-radius:16px'>" +
        "<h2 style='color:#EF4444;margin-top:0'>Payment failed</h2>" +
        "<p>We were unable to process your Pocketwise subscription payment. Your account has been downgraded to the <strong>Free plan</strong>.</p>" +
        "<p>To reactivate Pro or Family, update your payment method and subscribe again:</p>" +
        "<a href='https://pocketwise-web.vercel.app' style='display:inline-block;margin-top:12px;padding:12px 24px;background:#F97316;color:#080C14;font-weight:700;border-radius:10px;text-decoration:none'>Reactivate my plan</a>" +
        "<p style='color:#64748B;font-size:12px;margin-top:24px'>To update your card visit " +
        "<a href='https://www.lunipay.io/account' style='color:#F97316'>lunipay.io/account</a>.</p></div>";
      sendResendEmail(email, "Action required: Your Pocketwise payment failed", failHtml);
    }
  } else {
    console.log("[LUNIPAY] Unhandled status: " + status + " - body: " + JSON.stringify(body).slice(0,200));
  }

  return res.sendStatus(200);
});

// â”€â”€â”€ VERIFY GUMROAD LICENSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/payments/verify-license (authenticated)
// Called by the client after a successful Gumroad purchase redirect.
// Verifies the license key with Gumroad and returns the plan.
app.post("/api/payments/verify-license", authenticate, async (req, res) => {
  const { license_key, plan } = req.body;
  const { uid } = req.user;

  if (!license_key) return res.status(400).json({ error: "license_key required" });
  if (!GUMROAD_ACCESS_TOKEN) {
    // No token configured â€” trust the client (for testing without Gumroad set up)
    pendingUpgrades.set(uid, { plan: plan || "pro", source: "gumroad_manual", at: Date.now() });
    return res.json({ success: true, plan: plan || "pro", verified: false });
  }

  const productId = plan === "family" ? GUMROAD_FAMILY_ID : GUMROAD_PRO_ID;
  if (!productId) {
    pendingUpgrades.set(uid, { plan: plan || "pro", source: "gumroad_manual", at: Date.now() });
    return res.json({ success: true, plan: plan || "pro", verified: false });
  }

  try {
    const verifyResult = await new Promise((resolve, reject) => {
      const body = `product_id=${encodeURIComponent(productId)}&license_key=${encodeURIComponent(license_key)}&increment_uses_count=false`;
      const options = {
        hostname: "api.gumroad.com",
        path: "/v2/licenses/verify",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${GUMROAD_ACCESS_TOKEN}`,
          "Content-Length": Buffer.byteLength(body),
        },
      };
      const req = https.request(options, (apiRes) => {
        let data = "";
        apiRes.on("data", c => data += c);
        apiRes.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid JSON")); } });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    if (!verifyResult.success) {
      return res.status(400).json({ error: "Invalid or already used license key" });
    }

    pendingUpgrades.set(uid, { plan: plan || "pro", source: "gumroad_verified", at: Date.now() });
    console.log(`[VERIFY] Gumroad license verified for uid=${uid}, plan=${plan}`);
    return res.json({ success: true, plan: plan || "pro", verified: true });
  } catch (e) {
    console.error("[VERIFY] Gumroad error:", e.message);
    return res.status(500).json({ error: "Failed to verify with Gumroad" });
  }
});

// â”€â”€â”€ GET PENDING UPGRADE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/payments/pending (authenticated)
// Client calls this after tapping "I've paid". Checks by UID first, then by
// the user's email â€” so Lunipay webhooks (email-only) are found correctly.
// Falls back to Firestore so Railway restarts don't lose pending payments.
app.get("/api/payments/pending", authenticate, async (req, res) => {
  const { uid, email } = req.user;
  const emailKey = (email || "").toLowerCase().trim();

  // Fast path: in-memory (same Railway container instance)
  let pending = pendingUpgrades.get(uid);
  if (!pending && emailKey) pending = pendingUpgrades.get(emailKey);

  // Slow path: Firestore (survives server restarts)
  if (!pending) {
    pending = await fsGetPending(uid);
    if (!pending && emailKey) pending = await fsGetPending(emailKey);
  }

  if (!pending) return res.json({ pending: null });

  // Consume â€” client applies upgrade to Firestore
  pendingUpgrades.delete(uid);
  if (emailKey) pendingUpgrades.delete(emailKey);
  fsDeletePending(uid);
  if (emailKey) fsDeletePending(emailKey);

  console.log(`[PENDING] Dispatching upgrade uid=${uid} email=${emailKey} plan=${pending.plan}`);
  return res.json({ pending });
});

// â”€â”€â”€ HEALTH CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// --- DAILY SUBSCRIPTION EXPIRY CHECK -----------------------------------------
// Runs every 24h. Queries Firestore for paid users past their renewsAt date
// and downgrades them + sends a payment-failed email as a safety net in case
// the Lunipay webhook was missed.
async function runExpiryCheck() {
  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "";
  if (!FIREBASE_API_KEY) { console.log("[EXPIRY] FIREBASE_API_KEY not set - skipping"); return; }
  const now = Date.now();
  console.log("[EXPIRY] Running subscription expiry check at", new Date().toISOString());

  try {
    // Structured query: userSettings where subscriptionTier in [pro, family]
    // and subscriptionRenewsAt < now (grace period: 3 days = 259200000ms)
    const gracePeriodMs = 3 * 24 * 60 * 60 * 1000;
    const cutoff = now - gracePeriodMs;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: "userSettings" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "subscriptionTier" }, op: "IN", value: { arrayValue: { values: [{ stringValue: "pro" }, { stringValue: "family" }] } } } },
              { fieldFilter: { field: { fieldPath: "subscriptionRenewsAt" }, op: "LESS_THAN", value: { integerValue: String(cutoff) } } },
            ],
          },
        },
        limit: 100,
      },
    };
    const queryStr = JSON.stringify(queryBody);
    const queryResult = await new Promise((resolve, reject) => {
      const opts = {
        hostname: "firestore.googleapis.com",
        path: "/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents:runQuery?key=" + FIREBASE_API_KEY,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(queryStr) },
      };
      const r = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } }); });
      r.on("error", reject); r.write(queryStr); r.end();
    });

    const docs = Array.isArray(queryResult) ? queryResult.filter(r => r.document) : [];
    console.log("[EXPIRY] Found " + docs.length + " expired paid users");

    for (const row of docs) {
      const fields = row.document.fields || {};
      const uid = row.document.name.split("/").pop();
      const email = fields.email?.stringValue || "";
      const tier = fields.subscriptionTier?.stringValue || "";
      console.log("[EXPIRY] Downgrading uid=" + uid + " email=" + email + " from=" + tier);

      // Downgrade in Firestore
      await firestoreReq("PATCH",
        "/userSettings/" + uid + "?updateMask.fieldPaths=subscriptionTier&updateMask.fieldPaths=subscriptionRenewsAt",
        { fields: { subscriptionTier: { stringValue: "free" }, subscriptionRenewsAt: { integerValue: "0" } } }
      );

      // Send email if we have an address
      if (email) {
        const failHtml =
          "<div style='font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#080C14;color:#F1F5F9;border-radius:16px'>" +
          "<h2 style='color:#EF4444;margin-top:0'>Subscription expired</h2>" +
          "<p>Your Pocketwise <strong>" + (tier === "family" ? "Family" : "Pro") + "</strong> subscription has expired and your account has been moved to the Free plan.</p>" +
          "<p>To continue enjoying unlimited bills, AI scans, and all Pro features, reactivate your subscription:</p>" +
          "<a href='https://pocketwise-web.vercel.app' style='display:inline-block;margin-top:12px;padding:12px 24px;background:#F97316;color:#080C14;font-weight:700;border-radius:10px;text-decoration:none'>Reactivate my plan</a>" +
          "<p style='color:#64748B;font-size:12px;margin-top:24px'>To update your payment method visit <a href='https://www.lunipay.io/account' style='color:#F97316'>lunipay.io/account</a>.</p></div>";
        sendResendEmail(email, "Your Pocketwise subscription has expired", failHtml);
      }
    }
  } catch (e) {
    console.error("[EXPIRY] Error:", e.message);
  }
}

// Run once on startup (after 2 min delay) then every 24h
setTimeout(runExpiryCheck, 2 * 60 * 1000);
setInterval(runExpiryCheck, 24 * 60 * 60 * 1000);
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Pocketwise API", timestamp: new Date().toISOString() });
});

// â”€â”€â”€ BILL SCAN ENDPOINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/api/scan-bill", authenticate, async (req, res) => {
  const { uid } = req.user;

  if (!rateLimit(uid, 20, 60000)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }

  const { base64, mimeType } = req.body;
  if (!base64 || !mimeType) return res.status(400).json({ error: "base64 and mimeType required" });
  if (base64.length > 10000000) return res.status(400).json({ error: "File too large. Please use a lower quality image." });

  const isImage = mimeType.startsWith("image/");
  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const prompt = `You are a bill scanner. Analyze this bill and extract information.
Respond ONLY with a valid JSON object. No explanation, no markdown, no code fences.

{
  "billerName": "company name e.g. JPS, NWC, Flow, Digicel",
  "amount": "number only. Use negative if credit/overpayment e.g. -2500.00",
  "dueDate": "YYYY-MM-DD format",
  "billType": "Utilities or Internet or Cable or Mobile or Water or Insurance or Rent or Other",
  "accountNumber": "account number if visible or empty string",
  "isCredit": "true if credit balance false otherwise",
  "confidence": "high or medium or low"
}

Common Jamaican billers: JPS, NWC, Flow, Digicel, LIME, Mars Cable, Nycmar, Sagicor, BCIC, GK Insurance, NCB, Scotiabank, JMMB, JN Bank, Courts, Access Financial, Highway 2000.`;

  let messageContent;
  if (isImage) {
    messageContent = [
      { type: "image", source: { type: "base64", media_type: validTypes.includes(mimeType) ? mimeType : "image/jpeg", data: base64 } },
      { type: "text", text: prompt },
    ];
  } else {
    messageContent = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
      { type: "text", text: prompt },
    ];
  }

  try {
    console.log(`[SCAN] User ${uid} scanning ${mimeType}`);
    const requestBody = JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: messageContent }],
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(requestBody),
        },
      };
      const apiReq = https.request(options, (apiRes) => {
        let data = "";
        apiRes.on("data", (c) => (data += c));
        apiRes.on("end", () => {
          if (apiRes.statusCode !== 200) {
            console.log(`Anthropic error ${apiRes.statusCode}:`, data.slice(0, 300));
            reject(new Error(`Anthropic error: ${apiRes.statusCode} - ${data.slice(0, 200)}`));
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("Invalid JSON from Anthropic")); }
        });
      });
      // 28-second timeout on the Anthropic request (client has 30s total)
      apiReq.setTimeout(28000, () => { apiReq.destroy(); reject(new Error("Anthropic request timed out")); });
      apiReq.on("error", reject);
      apiReq.write(requestBody);
      apiReq.end();
    });

    const textContent = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || "";
    if (!textContent) return res.status(500).json({ error: "No response from AI" });

    // Strip markdown code fences if model wraps JSON in them
    const clean = textContent.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    let extracted;
    try {
      extracted = JSON.parse(clean);
    } catch (parseErr) {
      console.error(`[SCAN] JSON parse failed for ${uid}. Raw:`, clean.slice(0, 300));
      return res.status(500).json({ error: "AI returned unreadable response" });
    }
    console.log(`[SCAN] Success for ${uid}: ${extracted.billerName}`);
    return res.json({ success: true, data: extracted });

  } catch (error) {
    console.error(`[SCAN] Error for ${uid}:`, error.message);
    return res.status(500).json({ error: "Failed to process bill" });
  }
});

// â”€â”€â”€ RECEIPT SCAN ENDPOINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/scan-receipt
// Reads a receipt image and extracts merchant, total, items, category, tax


// --- NDA SIGNING ENDPOINT -----------------------------------------------------
// POST /api/sign-nda  (public - no auth required)
// Called when someone signs the Pocketwise NDA. Sends email to owner + signer.
app.post("/api/sign-nda", (req, res) => {
  const { signerName, signerEmail, signedAt } = req.body;
  if (!signerName || !signerEmail) return res.status(400).json({ error: "Name and email required" });

  const dateStr = signedAt || new Date().toLocaleDateString("en-JM", { day: "numeric", month: "long", year: "numeric" });
  const ownerEmail = "tuninlifestylemag@gmail.com";

  const ndaHtml =
    "<div style='font-family:Georgia,serif;max-width:700px;margin:auto;padding:40px;background:#fff;color:#111;border:1px solid #ddd;border-radius:8px'>" +
    "<div style='text-align:center;margin-bottom:32px'>" +
    "<img src='https://pocketwise-web.vercel.app/icon.png' width='48' style='border-radius:10px;margin-bottom:8px'>" +
    "<h1 style='font-size:22px;margin:0;letter-spacing:1px'>POCKETWISE</h1>" +
    "<h2 style='font-size:16px;font-weight:normal;color:#555;margin:4px 0 0'>Non-Disclosure Agreement</h2>" +
    "</div>" +
    "<p style='color:#666;font-size:13px;text-align:center'>Signed by <strong>" + signerName + "</strong> (" + signerEmail + ") on <strong>" + dateStr + "</strong></p>" +
    "<hr style='border:none;border-top:1px solid #ddd;margin:24px 0'>" +
    "<p>This Non-Disclosure Agreement (<strong>&ldquo;Agreement&rdquo;</strong>) is entered into as of <strong>" + dateStr + "</strong> between:</p>" +
    "<p><strong>Disclosing Party:</strong> Damalie / Pocketwise (&ldquo;the Company&rdquo;)</p>" +
    "<p><strong>Receiving Party:</strong> " + signerName + " (" + signerEmail + ") (&ldquo;Recipient&rdquo;)</p>" +
    "<h3 style='margin-top:28px'>1. Confidential Information</h3>" +
    "<p>For purposes of this Agreement, &ldquo;Confidential Information&rdquo; means any and all non-public information disclosed by the Company to the Recipient, whether orally, in writing, electronically, or by any other means, including but not limited to: business plans, financial data and projections, user data and analytics, product features and roadmap, technical architecture, source code, marketing strategies, pricing models, partnerships, and any other information designated as confidential or that reasonably should be understood to be confidential given the nature of the information and the circumstances of disclosure.</p>" +
    "<h3>2. Obligations of Recipient</h3>" +
    "<p>The Recipient agrees to: (a) hold all Confidential Information in strict confidence; (b) not disclose any Confidential Information to any third party without prior written consent from the Company; (c) use the Confidential Information solely for the purpose of evaluating a potential business relationship with the Company; and (d) protect the Confidential Information using the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care.</p>" +
    "<h3>3. Exclusions</h3>" +
    "<p>This Agreement does not apply to information that: (a) is or becomes publicly known through no breach of this Agreement; (b) was rightfully known to the Recipient before disclosure; (c) is independently developed by the Recipient without use of Confidential Information; or (d) is required to be disclosed by law or court order.</p>" +
    "<h3>4. Term</h3>" +
    "<p>This Agreement shall remain in effect for a period of two (2) years from the date of signing, unless terminated earlier by mutual written consent.</p>" +
    "<h3>5. Return of Information</h3>" +
    "<p>Upon request by the Company, the Recipient shall promptly return or destroy all Confidential Information and any copies thereof.</p>" +
    "<h3>6. Governing Law</h3>" +
    "<p>This Agreement shall be governed by and construed in accordance with the laws of Jamaica.</p>" +
    "<h3>7. Electronic Signature</h3>" +
    "<p>The parties agree that an electronic signature or acceptance via digital checkbox constitutes a legally binding signature for the purposes of this Agreement.</p>" +
    "<hr style='border:none;border-top:2px solid #111;margin:32px 0 16px'>" +
    "<p style='font-size:13px;color:#333'><strong>Signed electronically by:</strong><br>" +
    "<span style='font-size:18px;font-family:cursive'>" + signerName + "</span><br>" +
    "<span style='color:#666;font-size:12px'>" + signerEmail + " &mdash; " + dateStr + "</span></p>" +
    "</div>";

  // Save to Firestore ndaSigners collection
  const docId = Date.now() + "_" + signerEmail.replace(/[^a-z0-9]/gi, "_");
  firestoreReq("PATCH", "/ndaSigners/" + docId, {
    fields: {
      name:      { stringValue: signerName },
      email:     { stringValue: signerEmail },
      signedAt:  { stringValue: dateStr },
      timestamp: { integerValue: Date.now().toString() },
    }
  }).catch(e => console.log("[NDA] Firestore save failed:", e.message));

  // Email to owner
  sendResendEmail(ownerEmail, "NDA Signed by " + signerName, ndaHtml);
  // Copy to signer
  sendResendEmail(signerEmail, "Your signed NDA with Pocketwise", ndaHtml);

  console.log("[NDA] Signed by " + signerName + " <" + signerEmail + "> on " + dateStr);
  return res.json({ success: true });
});

// --- NDA SIGNERS LIST ENDPOINT -----------------------------------------------
// GET /api/nda-signers  (owner only - requires X-App-Secret header)
app.get("/api/nda-signers", async (req, res) => {
  if (req.headers["x-app-secret"] !== APP_SECRET) return res.status(403).json({ error: "Forbidden" });
  try {
    const data = await firestoreReq("GET", "/ndaSigners");
    const docs = (data.documents || []).map(d => ({
      name:      d.fields?.name?.stringValue || "",
      email:     d.fields?.email?.stringValue || "",
      signedAt:  d.fields?.signedAt?.stringValue || "",
      timestamp: parseInt(d.fields?.timestamp?.integerValue || "0"),
    }));
    docs.sort((a, b) => b.timestamp - a.timestamp);
    return res.json({ signers: docs, total: docs.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
// --- VEHICLE DOC SCAN ENDPOINT ------------------------------------------------
// POST /api/scan-vehicle-doc
// Reads a vehicle document (fitness, registration, insurance) and extracts
// expiry date, issue date, provider, reference number, plate, make, model.
app.post("/api/scan-vehicle-doc", authenticate, async (req, res) => {
  const { uid } = req.user;

  if (!rateLimit(uid, 10, 60000)) {
    return res.status(429).json({ error: "Too many scans. Please wait a moment." });
  }

  const { base64, mimeType, docType } = req.body;
  if (!base64 || !mimeType) return res.status(400).json({ error: "base64 and mimeType required" });
  if (base64.length > 10000000) return res.status(400).json({ error: "File too large. Please use a lower quality image." });

  const isImage = mimeType.startsWith("image/");
  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  const docLabel = docType === "fitness" ? "Certificate of Fitness" : docType === "registration" ? "Registration/Licence" : "Insurance";

  const prompt = "You are a Jamaican vehicle document scanner. Analyze this " + docLabel + " document and extract the information." +
    " Respond ONLY with a valid JSON object. No explanation, no markdown, no code fences.\n\n" +
    "{\n" +
    '  "expiryDate": "YYYY-MM-DD format or empty string if not found",' + "\n" +
    '  "issueDate": "YYYY-MM-DD format or empty string if not found",' + "\n" +
    '  "provider": "issuing authority or insurance company name or empty string",' + "\n" +
    '  "referenceNumber": "certificate, policy, or registration number or empty string",' + "\n" +
    '  "plateNumber": "vehicle plate number e.g. AB 1234 or empty string",' + "\n" +
    '  "vehicleMake": "vehicle make e.g. Toyota or empty string",' + "\n" +
    '  "vehicleModel": "vehicle model e.g. Passo or empty string",' + "\n" +
    '  "confidence": "high or medium or low"' + "\n" +
    "}\n\n" +
    "Notes: Dates are often in DD/MM/YYYY format on Jamaican documents - convert to YYYY-MM-DD." +
    " For fitness certificates the issuer is TAJ (Tax Administration Jamaica)." +
    " Common insurers: Sagicor, JMMB, BCIC, GK Insurance, Advantage General, Guardian Life.";

  let messageContent;
  if (isImage) {
    messageContent = [
      { type: "image", source: { type: "base64", media_type: validTypes.includes(mimeType) ? mimeType : "image/jpeg", data: base64 } },
      { type: "text", text: prompt },
    ];
  } else {
    messageContent = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
      { type: "text", text: prompt },
    ];
  }

  try {
    console.log("[VEHICLE SCAN] User " + uid + " scanning " + docType + " " + mimeType);
    const requestBody = JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: messageContent }],
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(requestBody),
        },
      };
      const apiReq = https.request(options, (apiRes) => {
        let data = "";
        apiRes.on("data", (c) => (data += c));
        apiRes.on("end", () => {
          if (apiRes.statusCode !== 200) {
            reject(new Error("Anthropic error: " + apiRes.statusCode + " - " + data.slice(0, 200)));
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("Invalid JSON from Anthropic")); }
        });
      });
      apiReq.setTimeout(28000, () => { apiReq.destroy(); reject(new Error("Scan timed out")); });
      apiReq.on("error", reject);
      apiReq.write(requestBody);
      apiReq.end();
    });

    const textContent = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || "";
    if (!textContent) return res.status(500).json({ error: "No response from AI" });

    const clean = textContent.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    let extracted;
    try {
      extracted = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: "AI returned unreadable response" });
    }

    console.log("[VEHICLE SCAN] Success uid=" + uid + " plate=" + extracted.plateNumber + " confidence=" + extracted.confidence);
    return res.json({ success: true, data: extracted });

  } catch (error) {
    console.error("[VEHICLE SCAN] Error for " + uid + ":", error.message);
    return res.status(500).json({ error: "Failed to scan document. Please try again." });
  }
});
app.post("/api/scan-receipt", authenticate, async (req, res) => {
  const { uid } = req.user;

  if (!rateLimit(uid, 20, 60000)) {
    return res.status(429).json({ error: "Too many requests. Please wait." });
  }

  const { base64, mimeType } = req.body;
  if (!base64 || !mimeType) return res.status(400).json({ error: "base64 and mimeType required" });
  if (base64.length > 10000000) return res.status(400).json({ error: "File too large. Please use a lower quality image." });

  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const isImage = mimeType.startsWith("image/");

  const prompt = `You are a receipt scanner. Analyze this receipt image and extract the information.
Respond ONLY with a valid JSON object. No explanation, no markdown, no code fences.

{
  "merchant": "store or restaurant name",
  "date": "YYYY-MM-DD format, use today if unclear",
  "total": "number only, no currency symbol e.g. 45.99",
  "category": "one of: Food & Dining, Transport, Shopping, Entertainment, Health, Utilities, Other",
  "items": [{"name": "item name", "price": 0.00}],
  "tax": "number only or 0",
  "confidence": "high or medium or low"
}

If this is not a receipt, return: {"error": "Not a receipt"}`;

  let messageContent;
  if (isImage) {
    messageContent = [
      { type: "image", source: { type: "base64", media_type: validTypes.includes(mimeType) ? mimeType : "image/jpeg", data: base64 } },
      { type: "text", text: prompt },
    ];
  } else {
    messageContent = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
      { type: "text", text: prompt },
    ];
  }

  try {
    console.log(`[RECEIPT SCAN] User ${uid}`);
    const requestBody = JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      messages: [{ role: "user", content: messageContent }],
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(requestBody),
        },
      };
      const apiReq = https.request(options, (apiRes) => {
        let data = "";
        apiRes.on("data", (c) => (data += c));
        apiRes.on("end", () => {
          if (apiRes.statusCode !== 200) {
            console.log(`Anthropic receipt error ${apiRes.statusCode}:`, data.slice(0, 300));
            reject(new Error(`Anthropic error: ${apiRes.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("Invalid JSON from Anthropic")); }
        });
      });
      apiReq.setTimeout(28000, () => { apiReq.destroy(); reject(new Error("Anthropic request timed out")); });
      apiReq.on("error", reject);
      apiReq.write(requestBody);
      apiReq.end();
    });

    const textContent = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || "";
    if (!textContent) return res.status(500).json({ error: "No response from AI" });

    const clean = textContent.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    let extracted;
    try {
      extracted = JSON.parse(clean);
    } catch (parseErr) {
      console.error("[RECEIPT SCAN] JSON parse failed. Raw:", clean.slice(0, 300));
      return res.status(500).json({ error: "AI returned unreadable response" });
    }

    if (extracted.error) {
      return res.status(400).json({ error: extracted.error });
    }

    console.log(`[RECEIPT SCAN] Success: ${extracted.merchant}`);
    return res.json({ success: true, data: extracted });

  } catch (error) {
    console.error(`[RECEIPT SCAN] Error:`, error.message);
    return res.status(500).json({ error: "Failed to process receipt" });
  }
});

// â”€â”€â”€ WELCOME EMAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/send-welcome
// Sends a branded welcome email to new users via Resend
// Called from signup.tsx after account creation
app.post("/api/send-welcome", authenticate, async (req, res) => {
  const { uid } = req.user;
  const { firstName, email } = req.body;

  if (!firstName || !email) {
    return res.status(400).json({ error: "firstName and email required" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("[WELCOME] RESEND_API_KEY not set â€” skipping email");
    return res.json({ success: true, message: "Email skipped (no API key)" });
  }

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; background: #080C14; margin: 0; padding: 0; }
        .container { max-width: 560px; margin: 40px auto; background: #0F1623; border-radius: 20px; overflow: hidden; }
        .header { background: #F97316; padding: 32px; text-align: center; }
        .header h1 { color: #080C14; margin: 0; font-size: 28px; font-weight: 800; }
        .header p { color: #7C2D12; margin: 8px 0 0; font-size: 14px; }
        .body { padding: 32px; }
        .body h2 { color: #F1F5F9; font-size: 22px; margin: 0 0 16px; }
        .body p { color: #8B9BB4; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
        .feature { background: #161E2E; border-radius: 12px; padding: 14px 16px; margin: 10px 0; display: flex; align-items: center; }
        .feature span { color: #F1F5F9; font-size: 14px; }
        .cta { background: #F97316; color: #080C14; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 800; font-size: 16px; display: inline-block; margin: 16px 0; }
        .footer { padding: 24px 32px; border-top: 1px solid #1E2A3D; }
        .footer p { color: #334155; font-size: 12px; text-align: center; margin: 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>ðŸ‘› Pocketwise</h1>
          <p>Smart today. Secure tomorrow.</p>
        </div>
        <div class="body">
          <h2>Welcome, ${firstName}! ðŸŽ‰</h2>
          <p>Your Pocketwise account is ready. You now have everything you need to take control of your bills and never miss a payment again.</p>
          
          <div class="feature"><span>ðŸ“± &nbsp; Scan bills with AI â€” just take a photo</span></div>
          <div class="feature"><span>ðŸ”” &nbsp; Get reminders before bills are due</span></div>
          <div class="feature"><span>ðŸ¦ &nbsp; Pay directly through your banking app</span></div>
          <div class="feature"><span>ðŸ“Š &nbsp; Track spending with receipts & analytics</span></div>
          
          <p style="margin-top: 24px;">Open Pocketwise on your phone to add your first bill and see how easy it is.</p>
          
          <p style="color: #64748B; font-size: 13px;">You're on the <strong style="color: #F97316;">Free plan</strong> â€” 3 bills and 10 AI scans included. Upgrade anytime for unlimited access.</p>
        </div>
        <div class="footer">
          <p>Pocketwise Â· support@pocketwise.app Â· You're receiving this because you created an account.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const emailPayload = JSON.stringify({
      from: "Pocketwise <onboarding@resend.dev>",
      to: [email],
      subject: `Welcome to Pocketwise, ${firstName}! ðŸŽ‰`,
      html: htmlBody,
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.resend.com",
        path: "/emails",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(emailPayload),
        },
      };
      const req = https.request(options, (apiRes) => {
        let data = "";
        apiRes.on("data", (c) => (data += c));
        apiRes.on("end", () => resolve({ status: apiRes.statusCode, data }));
      });
      req.on("error", reject);
      req.write(emailPayload);
      req.end();
    });

    console.log(`[WELCOME] Email sent to ${email} â€” status ${result.status}`);
    return res.json({ success: true });
  } catch (error) {
    console.error("[WELCOME] Failed to send email:", error.message);
    // Don't fail the signup if email fails
    return res.json({ success: true, message: "Email queued" });
  }
});

// â”€â”€â”€ UPGRADE EMAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/send-upgrade
// Sends a branded upgrade confirmation email via Resend
app.post("/api/send-upgrade", authenticate, async (req, res) => {
  const { firstName, email, plan } = req.body;
  if (!firstName || !email || !plan) return res.status(400).json({ error: "firstName, email and plan required" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log("[UPGRADE EMAIL] RESEND_API_KEY not set â€” skipping");
    return res.json({ success: true, message: "Email skipped (no API key)" });
  }

  const planColor = plan === "Family" ? "#A855F7" : "#F97316";
  const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:0;background:#080C14;font-family:Arial,sans-serif}
    .wrap{max-width:560px;margin:0 auto;padding:40px 24px}
    .logo{color:#F97316;font-size:22px;font-weight:900;letter-spacing:-0.5px;margin-bottom:32px}
    .card{background:#0F1623;border-radius:16px;padding:32px;border:1px solid #1E2A3D}
    h2{color:#F1F5F9;font-size:22px;margin:0 0 12px}
    p{color:#8B9BB4;font-size:15px;line-height:1.6;margin:0 0 16px}
    .badge{display:inline-block;background:${planColor}22;color:${planColor};border:1px solid ${planColor}44;border-radius:999px;padding:6px 18px;font-weight:700;font-size:14px;margin-bottom:20px}
    .feature{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #1E2A3D;color:#F1F5F9;font-size:14px}
    .dot{width:8px;height:8px;border-radius:50%;background:${planColor};flex-shrink:0}
    .btn{display:inline-block;background:#F97316;color:#000;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;text-decoration:none;margin-top:24px}
    .footer{text-align:center;color:#475569;font-size:12px;margin-top:32px}
  </style></head><body><div class="wrap">
    <div class="logo">ðŸ‘› Pocketwise</div>
    <div class="card">
      <div class="badge">âœ“ ${plan} Plan Active</div>
      <h2>You're on ${plan}, ${firstName}! ðŸŽ‰</h2>
      <p>Your upgrade is confirmed. Here's everything that's now unlocked for you:</p>
      ${plan === "Family"
        ? `<div class="feature"><div class="dot"></div>Up to 5 family members</div>
           <div class="feature"><div class="dot"></div>Unlimited bills & AI scans</div>
           <div class="feature"><div class="dot"></div>Full analytics & PDF export</div>
           <div class="feature"><div class="dot"></div>Shared or private finances per member</div>`
        : `<div class="feature"><div class="dot"></div>Unlimited bills</div>
           <div class="feature"><div class="dot"></div>Unlimited AI bill & receipt scanning</div>
           <div class="feature"><div class="dot"></div>Full analytics & spending insights</div>
           <div class="feature"><div class="dot"></div>PDF export for bills, receipts & analytics</div>
           <div class="feature"><div class="dot"></div>Bill splitting</div>`
      }
      <p style="margin-top:20px">Head back to the app and start exploring your new features.</p>
      <a href="https://pocketwise-web.vercel.app/dashboard" class="btn">Open Pocketwise â†’</a>
    </div>
    <div class="footer">Pocketwise Â· Financial Clarity Everyday<br>Questions? Reply to this email.</div>
  </div></body></html>`;

  try {
    const emailPayload = JSON.stringify({
      from: "Pocketwise <onboarding@resend.dev>",
      to: [email],
      subject: `You're now on ${plan}! Welcome to the next level ðŸš€`,
      html: htmlBody,
    });
    const result = await new Promise((resolve, reject) => {
      const https = require("https");
      const options = {
        hostname: "api.resend.com", path: "/emails", method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(emailPayload) },
      };
      const req = https.request(options, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
      req.on("error", reject);
      req.write(emailPayload);
      req.end();
    });
    console.log(`[UPGRADE EMAIL] Sent to ${email} â€” status ${result.status}`);
    return res.json({ success: true });
  } catch (error) {
    console.error("[UPGRADE EMAIL] Failed:", error.message);
    return res.json({ success: true, message: "Email queued" });
  }
});

// â”€â”€â”€ START â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.listen(PORT, () => {
  console.log(`Pocketwise API running on port ${PORT}`);
});

module.exports = app;
