/**
 * KORTA — Create Yoco Checkout
 *
 * The browser sends the cart here. This function prices the cart against the
 * server-side catalogue (never trusting the amount the browser claims), asks
 * Yoco to create a checkout, and returns the redirect URL.
 *
 * Requires the environment variable YOCO_SECRET_KEY (set in Netlify, never in
 * the website). The secret key is only ever used here, server-side.
 */

// ---------------------------------------------------------------------------
// PRICE LIST — the single source of truth for what things cost.
// Prices are in RAND. Keep these in step with index.html.
// A customer cannot change these; the browser only sends product names + qty.
// ---------------------------------------------------------------------------
const PRICES = {
  // Rackets
  "KORTA Pro Carbon X": 4299,
  "Bullpadel Vertex 04": 5150,
  "HEAD Extreme Pro": 4850,
  "Adidas Metalbone": 5600,
  "KORTA Attack Diamond": 4650,
  "KORTA Balance 2.0": 3450,
  "Wilson Bela Team": 3990,
  "Babolat Air Veron": 4120,
  "KORTA Junior Control": 2499,
  "NOX AT10 Genius": 3899,
  // Balls
  "KORTA Tour Ball (3-Tube)": 249,
  "KORTA Match Ball (3-Tube)": 199,
  "Padel Trainer Balls (12)": 649,
  "KORTA Pro Ball (Box of 24)": 1749,
  // Bags
  "Pro Padel Racket Bag": 1890,
  "Weekend Padel Duffel": 1290,
  "Court Backpack": 1150,
  "Pro Tour Bag XL": 2490,
  // Apparel
  "Performance Tee — Ice": 649,
  "Match Shorts — Black": 749,
  "Training Hoodie — Slate": 1190,
  "Performance Polo — White": 849,
  // Shoes
  "Court Grip Trainer": 2399,
  "Clay Control Shoe": 2190,
  "Pro Stability Trainer": 2890,
  // Accessories
  "Overgrip 3-Pack": 149,
  "Racket Protector": 199,
  "Wristband Pair": 179,
  "Padel Ball Holder Clip": 129,
};

const YOCO_API = "https://payments.yoco.com/api/checkouts";

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) {
    console.error("YOCO_SECRET_KEY is not set in environment variables");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Payment is not configured yet. Please contact us." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const cart = Array.isArray(payload.cart) ? payload.cart : [];
  if (!cart.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Your bag is empty" }) };
  }

  // --- Price the cart server-side. The browser's totals are ignored. ---
  let totalRand = 0;
  const lineItems = [];
  const unknown = [];

  for (const item of cart) {
    const name = String(item.name || "").trim();
    const qty = Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1));
    const unitPrice = PRICES[name];

    if (unitPrice === undefined) {
      unknown.push(name);
      continue;
    }
    totalRand += unitPrice * qty;
    lineItems.push({
      displayName: name,
      quantity: qty,
      pricingDetails: { price: Math.round(unitPrice * 100) }, // cents
    });
  }

  if (unknown.length) {
    console.error("Unknown products in cart:", unknown);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Some items are no longer available. Please refresh and try again." }),
    };
  }
  if (totalRand <= 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid order total" }) };
  }

  const amountInCents = Math.round(totalRand * 100);

  // Where the customer comes back to after paying
  const origin =
    (event.headers && (event.headers.origin || `https://${event.headers.host}`)) ||
    "https://korta.co.za";

  // A simple readable order reference
  const orderRef = "KORTA-" + Date.now().toString().slice(-8);

  const body = {
    amount: amountInCents,
    currency: "ZAR",
    successUrl: `${origin}/?payment=success&ref=${orderRef}`,
    cancelUrl: `${origin}/?payment=cancelled`,
    failureUrl: `${origin}/?payment=failed`,
    lineItems,
    metadata: {
      orderRef,
      customerName: String(payload.name || "").slice(0, 120),
      customerEmail: String(payload.email || "").slice(0, 160),
      customerPhone: String(payload.phone || "").slice(0, 40),
      deliveryAddress: String(payload.address || "").slice(0, 400),
      items: cart
        .map((i) => `${i.name} x${Math.max(1, parseInt(i.qty, 10) || 1)}`)
        .join(" | ")
        .slice(0, 900),
    },
  };

  try {
    const res = await fetch(YOCO_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
        "Idempotency-Key": orderRef,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("Yoco checkout failed:", res.status, data);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "We could not start the payment. Please try again." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        redirectUrl: data.redirectUrl,
        checkoutId: data.id,
        orderRef,
        total: totalRand,
      }),
    };
  } catch (err) {
    console.error("Error creating checkout:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Something went wrong. Please try again." }),
    };
  }
};
