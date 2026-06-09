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
function verifyFirebaseToken(idToken) {
  return new Promise((resolve, reject) => {
    const parts = idToken.split(".");
    if (parts.length !== 3) return reject(new Error("Invalid token format"));
    let header, payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    } catch { return reject(new Error("Invalid token encoding")); }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return reject(new Error("Token expired"));
    if (payload.aud !== FIREBASE_PROJECT_ID) return reject(new Error("Invalid audience"));
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return reject(new Error("Invalid issuer"));
    if (!payload.sub) return reject(new Error("No subject"));

    https.get(
      "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const keys = JSON.parse(data);
            if (!keys[header.kid]) return reject(new Error("Key not found"));
            resolve({ uid: payload.sub, email: payload.email });
          } catch { reject(new Error("Key verification failed")); }
        });
      }
    ).on("error", () => reject(new Error("Could not fetch public keys")));
  });
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
      model: "claude-sonnet-4-5",
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
            console.log(`Anthropic error ${apiRes.statusCode}:`, data);
            reject(new Error(`Anthropic error: ${apiRes.statusCode}`));
            return;
          }
          resolve(JSON.parse(data));
        });
      });
      apiReq.on("error", reject);
      apiReq.write(requestBody);
      apiReq.end();
    });

    const textContent = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || "";
    if (!textContent) return res.status(500).json({ error: "No response from AI" });

    const clean = textContent.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const extracted = JSON.parse(clean);
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
      model: "claude-sonnet-4-5",
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
            reject(new Error(`Anthropic error: ${apiRes.statusCode}`));
            return;
          }
          resolve(JSON.parse(data));
        });
      });
      apiReq.on("error", reject);
      apiReq.write(requestBody);
      apiReq.end();
    });

    const textContent = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || "";
    if (!textContent) return res.status(500).json({ error: "No response from AI" });

    const clean = textContent.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const extracted = JSON.parse(clean);

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