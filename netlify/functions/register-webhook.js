/**
 * KORTA — One-off webhook registration helper
 *
 * Visit this function once in your browser to register the yoco-webhook
 * endpoint with Yoco. It uses YOCO_SECRET_KEY from the environment, so the
 * key never appears in a browser or a URL.
 *
 * Yoco returns a signing secret ONCE. Copy it immediately and add it to
 * Netlify as YOCO_WEBHOOK_SECRET.
 *
 * DELETE THIS FILE once the webhook is registered — it is not needed again.
 */
 
exports.handler = async (event) => {
  const secretKey = process.env.YOCO_SECRET_KEY;
  const html = (body) =>
    `<!doctype html><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Register Yoco webhook</title>
     <style>
       body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            background:#111;color:#eee;padding:28px;line-height:1.6;max-width:640px;margin:0 auto}
       h1{font-size:20px;margin:0 0 18px}
       .box{background:#1c1c1c;border:1px solid #333;border-radius:12px;padding:18px;margin:16px 0}
       .key{background:#0a2a1a;border:1px solid #1d7a4c;color:#7CF0B0;
            font-family:ui-monospace,Menlo,monospace;font-size:15px;word-break:break-all;
            padding:16px;border-radius:10px;margin:12px 0}
       .warn{color:#ffcf6b}
       .err{color:#ff8080}
       code{background:#000;padding:2px 6px;border-radius:4px;font-size:13px}
       ol{padding-left:20px}
     </style>
     ${body}`;
 
  if (!secretKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html" },
      body: html(`<h1 class="err">YOCO_SECRET_KEY is not set</h1>
        <p>Add it in Netlify → Site configuration → Environment variables, then redeploy.</p>`),
    };
  }
 
  const site =
    (event.headers && (event.headers.origin || `https://${event.headers.host}`)) ||
    "https://tranquil-shortbread-cddfec.netlify.app";
  const webhookUrl = `${site}/.netlify/functions/yoco-webhook`;
 
  try {
    const res = await fetch("https://payments.yoco.com/api/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        name: "korta-orders",
        url: webhookUrl,
      }),
    });
 
    const data = await res.json().catch(() => ({}));
 
    if (!res.ok) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/html" },
        body: html(`<h1 class="err">Registration failed (${res.status})</h1>
          <div class="box"><pre>${JSON.stringify(data, null, 2)}</pre></div>
          <p>If it says a webhook already exists, that's fine — it's already registered.</p>`),
      };
    }
 
    const signingSecret = data.secret || data.signingSecret || "(not returned — check response below)";
 
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: html(`
        <h1>✅ Webhook registered</h1>
        <div class="box">
          <strong>Endpoint</strong><br>
          <code>${webhookUrl}</code>
        </div>
 
        <h2 style="font-size:16px">Your signing secret</h2>
        <p class="warn">⚠ Shown once only. Copy it now.</p>
        <div class="key">${signingSecret}</div>
 
        <div class="box">
          <strong>Next steps</strong>
          <ol>
            <li>Copy the secret above</li>
            <li>Netlify → Site configuration → Environment variables</li>
            <li>Add key <code>YOCO_WEBHOOK_SECRET</code> with that value</li>
            <li>Deploys → Trigger deploy → Deploy site</li>
            <li><strong>Delete register-webhook.js from your repo</strong> — it's done its job</li>
          </ol>
        </div>
 
        <details class="box"><summary>Full response</summary>
          <pre>${JSON.stringify(data, null, 2)}</pre>
        </details>`),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html" },
      body: html(`<h1 class="err">Error</h1><div class="box">${err.message}</div>`),
    };
  }
};
