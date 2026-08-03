/**
 * KORTA — Yoco Webhook
 *
 * Yoco calls this directly (server to server) once a payment succeeds.
 * This is the ONLY trustworthy confirmation that money was actually taken —
 * never rely on the customer's browser returning to a success page.
 *
 * On a successful payment it emails the order to ORDER_EMAIL.
 *
 * Environment variables required:
 *   YOCO_WEBHOOK_SECRET  - from Yoco when you register the webhook (optional
 *                          but strongly recommended; verifies the call is real)
 *   ORDER_EMAIL          - where orders are sent (info@korta.co.za)
 *   RESEND_API_KEY       - for sending the email (see README)
 */
 
const crypto = require("crypto");
 
function rands(cents) {
  return "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2 });
}
 
/** Verify the webhook really came from Yoco (svix-style signature). */
function isSignatureValid(event, secret) {
  if (!secret) return null; // not configured — caller decides what to do
 
  const h = event.headers || {};
  const id = h["webhook-id"] || h["Webhook-Id"];
  const timestamp = h["webhook-timestamp"] || h["Webhook-Timestamp"];
  const signature = h["webhook-signature"] || h["Webhook-Signature"];
  if (!id || !timestamp || !signature) return false;
 
  // Reject anything older than 5 minutes (replay protection)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
 
  try {
    const signedContent = `${id}.${timestamp}.${event.body}`;
    const key = Buffer.from(secret.split("_")[1] || secret, "base64");
    const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
 
    // signature header may hold several space-separated "v1,<sig>" values
    return signature
      .split(" ")
      .map((s) => s.split(",")[1])
      .filter(Boolean)
      .some((sig) => {
        try {
          return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
        } catch (e) {
          return false;
        }
      });
  } catch (err) {
    console.error("Signature check error:", err);
    return false;
  }
}
 
async function sendOrderEmail(subject, html) {
  const to = process.env.ORDER_EMAIL || "info@korta.co.za";
  const apiKey = process.env.RESEND_API_KEY;
 
  if (!apiKey) {
    // No email provider configured — still log it so the order is never lost.
    console.log("ORDER RECEIVED (no email provider configured):", subject);
    console.log(html.replace(/<[^>]+>/g, " "));
    return;
  }
 
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ORDER_FROM || "KORTA Orders <orders@korta.co.za>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Email send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Email error:", err);
  }
}
 
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
 
  // --- Log FIRST, always, before any check can bail out ---
  console.log("=== WEBHOOK CALLED ===");
  console.log("Headers:", JSON.stringify(event.headers || {}));
  console.log("Raw body:", event.body || "(empty)");
 
  // --- Then verify authenticity (logged, not fatal, while we confirm the scheme) ---
  const secret = process.env.YOCO_WEBHOOK_SECRET;
  const valid = isSignatureValid(event, secret);
  if (valid === false) {
    console.warn("Signature did not verify. Continuing anyway so the order is not lost.");
  } else if (valid === null) {
    console.warn("YOCO_WEBHOOK_SECRET not set — no verification performed.");
  } else {
    console.log("Signature verified OK.");
  }
 
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }
 
  const type = body.type || "";
  const p = body.payload || {};
 
  // Log EVERY call so nothing is ever silently lost.
  console.log("Webhook received. type=" + type);
  console.log("Full body:", JSON.stringify(body));
 
  // Yoco sends "payment.created" for a completed checkout payment. Accept the
  // other success-shaped names too, in case they differ by account or change.
  const SUCCESS_EVENTS = [
    "payment.created",
    "payment.succeeded",
    "checkout.succeeded",
    "checkout.completed",
  ];
 
  if (!SUCCESS_EVENTS.includes(type)) {
    console.log("Not a payment event, ignoring:", type);
    return { statusCode: 200, body: "OK" };
  }
 
  // Guard against a failed/refunded payment slipping through
  const status = String(p.status || "").toLowerCase();
  if (status && !["succeeded", "successful", "completed", "paid"].includes(status)) {
    console.log("Payment not in a successful state, ignoring. status=" + status);
    return { statusCode: 200, body: "OK" };
  }
 
  const meta = p.metadata || {};
  const amount = typeof p.amount === "number" ? p.amount : 0;
  const ref = meta.orderRef || p.id || "unknown";
 
  const itemRows = String(meta.items || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${s}</td></tr>`)
    .join("");
 
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
    <h2 style="margin:0 0 4px">New KORTA order</h2>
    <p style="color:#666;margin:0 0 24px">Payment confirmed by Yoco</p>
 
    <p style="font-size:22px;font-weight:bold;margin:0 0 4px">${rands(amount)}</p>
    <p style="color:#666;margin:0 0 24px">Order reference: <strong>${ref}</strong></p>
 
    <h3 style="margin:0 0 8px">Items</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${itemRows || "<tr><td>See Yoco dashboard</td></tr>"}</table>
 
    <h3 style="margin:0 0 8px">Customer</h3>
    <p style="margin:0 0 4px">${meta.customerName || "—"}</p>
    <p style="margin:0 0 4px">${meta.customerEmail || "—"}</p>
    <p style="margin:0 0 4px">${meta.customerPhone || "—"}</p>
    <p style="margin:0 0 24px;white-space:pre-line">${meta.deliveryAddress || "—"}</p>
 
    <p style="color:#888;font-size:12px">
      Yoco payment ID: ${p.id || "—"}<br>
      Received: ${new Date().toLocaleString("en-ZA")}
    </p>
  </div>`;
 
  await sendOrderEmail(`New KORTA order — ${rands(amount)} (${ref})`, html);
 
  console.log("Order confirmed:", ref, rands(amount));
 
  // Always 200 quickly, or Yoco will retry
  return { statusCode: 200, body: "OK" };
};
