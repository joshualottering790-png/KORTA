/**
 * KORTA — create-checkout
 *
 * Creates a Yoco Checkout session.
 *
 * Prices come from MongoDB, never from the browser. The browser sends only
 * product identifiers and quantities; this function looks up the real price
 * and calculates the total. A customer therefore cannot pay less by editing
 * the page, and the price shown on the site can never drift apart from the
 * price charged.
 *
 * Requires environment variables:
 *   YOCO_SECRET_KEY
 *   MONGODB_URI
 */

const { MongoClient } = require('mongodb');

let cachedDb = null;
async function getDb() {
  if (cachedDb) return cachedDb;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  cachedDb = client.db('korta');
  return cachedDb;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) {
    console.error('YOCO_SECRET_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Payment is not configured' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const cart = Array.isArray(body.cart) ? body.cart : [];
    if (!cart.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Your bag is empty' }) };
    }

    const db = await getDb();
    const col = db.collection('products');

    const keys = cart.map(i => String(i.sku || i.name || '').trim()).filter(Boolean);
    const found = await col.find({
      $or: [{ sku: { $in: keys } }, { name: { $in: keys } }],
    }).toArray();

    const bySku  = new Map(found.map(p => [p.sku, p]));
    const byName = new Map(found.map(p => [p.name, p]));

    let totalRand = 0;
    const lineItems = [];
    const problems = [];

    for (const item of cart) {
      const key = String(item.sku || item.name || '').trim();
      const qty = Math.max(1, Math.min(20, parseInt(item.qty, 10) || 1));
      const p = bySku.get(key) || byName.get(key);

      if (!p) { problems.push(key + ' is no longer available'); continue; }
      if (!p.active || !(p.price > 0)) { problems.push(p.name + ' is not currently for sale'); continue; }
      if (p.stock === 0) { problems.push(p.name + ' is sold out'); continue; }
      if (typeof p.stock === 'number' && p.stock < qty) {
        problems.push('Only ' + p.stock + ' of ' + p.name + ' left'); continue;
      }

      totalRand += p.price * qty;
      lineItems.push({
        displayName: p.name,
        quantity: qty,
        pricingDetails: { price: Math.round(p.price * 100) },
      });
    }

    if (problems.length) {
      return { statusCode: 400, body: JSON.stringify({ error: problems[0] }) };
    }
    if (totalRand < 2) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Order total is too low' }) };
    }

    const orderRef = 'KORTA-' + Date.now().toString(36).toUpperCase();
    const site = process.env.URL || 'https://korta.co.za';

    const payload = {
      amount: Math.round(totalRand * 100),
      currency: 'ZAR',
      successUrl: site + '/?payment=success&ref=' + orderRef,
      cancelUrl:  site + '/?payment=cancelled',
      failureUrl: site + '/?payment=failed',
      lineItems,
      metadata: {
        orderRef,
        customerName:    String(body.name    || '').slice(0, 120),
        customerEmail:   String(body.email   || '').slice(0, 120),
        customerPhone:   String(body.phone   || '').slice(0, 40),
        deliveryAddress: String(body.address || '').slice(0, 400),
        items: lineItems.map(l => l.displayName + ' x' + l.quantity).join(' | ').slice(0, 900),
      },
    };

    const res = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + secretKey,
        'Idempotency-Key': orderRef,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Yoco checkout failed:', res.status, data);
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not start payment. Please try again.' }) };
    }

    try {
      await db.collection('orders').insertOne({
        orderRef,
        status: 'pending',
        total: totalRand,
        items: lineItems.map(l => ({
          name: l.displayName, qty: l.quantity, price: l.pricingDetails.price / 100,
        })),
        customer: {
          name: payload.metadata.customerName,
          email: payload.metadata.customerEmail,
          phone: payload.metadata.customerPhone,
          address: payload.metadata.deliveryAddress,
        },
        createdAt: new Date(),
      });
    } catch (e) {
      console.error('could not save order (payment still proceeds):', e.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUrl: data.redirectUrl, orderRef, amount: totalRand }),
    };

  } catch (err) {
    console.error('create-checkout error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
