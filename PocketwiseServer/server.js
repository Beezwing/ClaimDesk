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

// ─── RATE LIMITER ──────────────────────────────────────────────────────────────
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

// ─── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Secret, X-Firebase-Token");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── FIREBASE TOKEN VERIFIER ───────────────────────────────────────────────────
// Cache public keys — they rotate every ~6 hours; we cache for 5 hours to avoid
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
          } catch { reject(new Error("Key fetch failed — invalid JSON from Google")); }
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

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
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

// ─── PAYMENT CONFIG ───────────────────────────────────────────────────────────
const GUMROAD_ACCESS_TOKEN  = process.env.GUMROAD_ACCESS_TOKEN  || "";
const GUMROAD_PRO_ID        = process.env.GUMROAD_PRO_ID        || "";
const GUMROAD_FAMILY_ID     = process.env.GUMROAD_FAMILY_ID     || "";
const LUNIPAY_WEBHOOK_SECRET = process.env.LUNIPAY_WEBHOOK_SECRET || "";

// Public Firebase API key (same as in mobile/web apps — safe to include here)
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyCtkq13sK18fI8jbXp2X9Sj745GPyRvLhE";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// In-memory store (fast path) — also write-through to Firestore (survives restarts)
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

// ─── GUMROAD WEBHOOK ──────────────────────────────────────────────────────────
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
    console.log("[GUMROAD WEBHOOK] No uid or email — cannot map to user");
    return res.sendStatus(200); // still 200 so Gumroad doesn't retry
  }

  let plan = "pro";
  if (GUMROAD_FAMILY_ID && (productId === GUMROAD_FAMILY_ID)) plan = "family";

  const isRefund = body.refunded === "true";
  const isCancelled = body.subscription_cancelled === "true" || body.ended_at;

  if (isRefund || isCancelled) {
    // Downgrade — store downgrade signal
    if (uid) pendingUpgrades.set(uid, { plan: "free", source: "gumroad", saleId, at: Date.now() });
    console.log(`[GUMROAD] Downgrade to free for uid=${uid}`);
  } else {
    if (uid) pendingUpgrades.set(uid, { plan, source: "gumroad", saleId, email, at: Date.now() });
    console.log(`[GUMROAD] Upgrade to ${plan} for uid=${uid}`);
  }

  return res.sendStatus(200);
});

// ─── LUNIPAY WEBHOOK ─────────────────────────────────────────────────────────
// POST /api/payments/lunipay-webhook
// Lunipay fires this on payment. We key upgrades by email since Lunipay
// doesn't support success-redirect URLs with our UID embedded.
app.post("/api/payments/lunipay-webhook", (req, res) => {
  const body = req.body;
  console.log("[LUNIPAY WEBHOOK]", JSON.stringify(body).slice(0, 500));

  // Lunipay sends customer email + any metadata set on the payment link
  const email  = (body?.customer?.email || body?.email || body?.customer_email || "").toLowerCase().trim();
  const uid    = body?.metadata?.uid  || body?.uid  || "";
  const plan   = body?.metadata?.plan || body?.plan || "pro";
  const status = body?.status || body?.payment_status || body?.event || "";

  // Treat any webhook as "paid" unless it is explicitly a failure/refund/cancellation.
  // Lunipay only POSTs webhooks for successful payments in practice.
  const isCancelled  = Boolean(status) && ["refunded","cancelled","failed","payment.failed","charge.failed",
    "checkout.session.expired","subscription_cancelled","payment_failed","charge_failed"].some(s => status.toLowerCase().includes(s));
  const isPaid       = !isCancelled;

  if (isPaid) {
    const entry = { plan, source: "lunipay", email, at: Date.now() };
    if (uid)   { pendingUpgrades.set(uid, entry);   fsSetPending(uid, entry); }
    if (email) { pendingByEmail.set(email, uid || email); pendingUpgrades.set(email, entry); fsSetPending(email, entry); }
    console.log(`[LUNIPAY] Upgrade to ${plan} — uid=${uid || "unknown"} email=${email}`);
  } else if (isCancelled) {
    const entry = { plan: "free", source: "lunipay", email, at: Date.now() };
    if (uid)   { pendingUpgrades.set(uid,   entry); fsSetPending(uid, entry); }
    if (email) { pendingUpgrades.set(email, entry); fsSetPending(email, entry); }
    console.log(`[LUNIPAY] Downgrade to free — email=${email}`);
  } else {
    console.log(`[LUNIPAY] Unhandled status: ${status} — full body: ${JSON.stringify(body)}`);
  }

  return res.sendStatus(200);
});

// ─── VERIFY GUMROAD LICENSE ──────────────────────────────────────────────────
// POST /api/payments/verify-license (authenticated)
// Called by the client after a successful Gumroad purchase redirect.
// Verifies the license key with Gumroad and returns the plan.
app.post("/api/payments/verify-license", authenticate, async (req, res) => {
  const { license_key, plan } = req.body;
  const { uid } = req.user;

  if (!license_key) return res.status(400).json({ error: "license_key required" });
  if (!GUMROAD_ACCESS_TOKEN) {
    // No token configured — trust the client (for testing without Gumroad set up)
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

// ─── GET PENDING UPGRADE ─────────────────────────────────────────────────────
// GET /api/payments/pending (authenticated)
// Client calls this after tapping "I've paid". Checks by UID first, then by
// the user's email — so Lunipay webhooks (email-only) are found correctly.
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

  // Consume — client applies upgrade to Firestore
  pendingUpgrades.delete(uid);
  if (emailKey) pendingUpgrades.delete(emailKey);
  fsDeletePending(uid);
  if (emailKey) fsDeletePending(emailKey);

  console.log(`[PENDING] Dispatching upgrade uid=${uid} email=${emailKey} plan=${pending.plan}`);
  return res.json({ pending });
});

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Pocketwise API", timestamp: new Date().toISOString() });
});

// ─── BILL SCAN ENDPOINT ────────────────────────────────────────────────────────
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

// ─── RECEIPT SCAN ENDPOINT ────────────────────────────────────────────────────
// POST /api/scan-receipt
// Reads a receipt image and extracts merchant, total, items, category, tax
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

// ─── WELCOME EMAIL ────────────────────────────────────────────────────────────
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
    console.log("[WELCOME] RESEND_API_KEY not set — skipping email");
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
          <h1>👛 Pocketwise</h1>
          <p>Smart today. Secure tomorrow.</p>
        </div>
        <div class="body">
          <h2>Welcome, ${firstName}! 🎉</h2>
          <p>Your Pocketwise account is ready. You now have everything you need to take control of your bills and never miss a payment again.</p>
          
          <div class="feature"><span>📱 &nbsp; Scan bills with AI — just take a photo</span></div>
          <div class="feature"><span>🔔 &nbsp; Get reminders before bills are due</span></div>
          <div class="feature"><span>🏦 &nbsp; Pay directly through your banking app</span></div>
          <div class="feature"><span>📊 &nbsp; Track spending with receipts & analytics</span></div>
          
          <p style="margin-top: 24px;">Open Pocketwise on your phone to add your first bill and see how easy it is.</p>
          
          <p style="color: #64748B; font-size: 13px;">You're on the <strong style="color: #F97316;">Free plan</strong> — 3 bills and 10 AI scans included. Upgrade anytime for unlimited access.</p>
        </div>
        <div class="footer">
          <p>Pocketwise · support@pocketwise.app · You're receiving this because you created an account.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const emailPayload = JSON.stringify({
      from: "Pocketwise <welcome@pocketwise.app>",
      to: [email],
      subject: `Welcome to Pocketwise, ${firstName}! 🎉`,
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

    console.log(`[WELCOME] Email sent to ${email} — status ${result.status}`);
    return res.json({ success: true });
  } catch (error) {
    console.error("[WELCOME] Failed to send email:", error.message);
    // Don't fail the signup if email fails
    return res.json({ success: true, message: "Email queued" });
  }
});

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Pocketwise API running on port ${PORT}`);
});

module.exports = app;