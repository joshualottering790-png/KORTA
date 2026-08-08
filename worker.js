/**
 * KORTA — Cloudflare Worker entry point
 *
 * Cloudflare Workers (unlike the old Pages platform) does not auto-route a
 * functions/ folder. Every request arrives here, so this file does the routing:
 *
 *   /api/get-products      GET   catalogue from MongoDB
 *   /api/create-checkout   POST  starts a Yoco payment
 *   /api/yoco-webhook      POST  Yoco confirms payment
 *   /api/import-products   GET   one-off import (delete after use)
 *   everything else              static files (index.html, images, ...)
 *
 * Environment variables:
 *   MONGODB_URI          standard connection string, NOT mongodb+srv://
 *   YOCO_SECRET_KEY
 *   IMPORT_KEY
 *   YOCO_WEBHOOK_SECRET  optional
 *   ORDER_EMAIL          optional
 *   RESEND_API_KEY       optional
 */

import { MongoClient } from 'mongodb';
import products from './products.json';

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

let client = null;
async function getDb(env) {
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!client) {
    client = new MongoClient(env.MONGODB_URI, {
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 8000,
    });
    await client.connect();
  }
  return client.db('korta');
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });

const html = (body, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#111;color:#eee;
     padding:26px;max-width:660px;margin:0 auto;line-height:1.6}
     .box{background:#1c1c1c;border:1px solid #333;border-radius:12px;padding:16px;margin:14px 0}
     .ok{color:#7CF0B0}.err{color:#ff8080}code{background:#000;padding:2px 6px;border-radius:4px}</style>
     ${body}`,
    { status, headers: { 'Content-Type': 'text/html' } }
  );

const rands = (cents) =>
  'R ' + (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 });

/* ------------------------------------------------------------------ */
/* GET /api/get-products                                               */
/* ------------------------------------------------------------------ */

async function getProducts(request, env) {
  const headers = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' };
  try {
    const url = new URL(request.url);
    const db = await getDb(env);

    const filter = { active: true, price: { $gt: 0 } };
    const category = url.searchParams.get('category');
    const sku = url.searchParams.get('sku');
    if (category) filter.category = category;
    if (sku) filter.sku = sku;

    const list = await db
      .collection('products')
      .find(filter, { projection: { _id: 0, cost: 0, catalogPage: 0 } })
      .sort({ category: 1, price: -1 })
      .limit(500)
      .toArray();

    return json({ count: list.length, products: list }, 200, headers);
  } catch (err) {
    console.error('get-products failed:', err && err.message);
    // the site falls back to its bundled catalogue, so fail quietly
    return json({ count: 0, products: [], error: 'catalogue unavailable' }, 200, headers);
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/create-checkout                                           */
/* ------------------------------------------------------------------ */

async function createCheckout(request, env) {
  if (!env.YOCO_SECRET_KEY) {
    console.error('YOCO_SECRET_KEY is not set');
    return json({ error: 'Payment is not configured' }, 500);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const cart = Array.isArray(body.cart) ? body.cart : [];
    if (!cart.length) return json({ error: 'Your bag is empty' }, 400);

    const db = await getDb(env);
    const col = db.collection('products');

    const keys = cart.map(i => String(i.sku || i.name || '').trim()).filter(Boolean);
    const found = await col.find({
      $or: [{ sku: { $in: keys } }, { name: { $in: keys } }],
    }).toArray();

    const bySku = new Map(found.map(p => [p.sku, p]));
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

    if (problems.length) return json({ error: problems[0] }, 400);
    if (totalRand < 2) return json({ error: 'Order total is too low' }, 400);

    const orderRef = 'KORTA-' + Date.now().toString(36).toUpperCase();
    const site = new URL(request.url).origin;

    const payload = {
      amount: Math.round(totalRand * 100),
      currency: 'ZAR',
      successUrl: site + '/?payment=success&ref=' + orderRef,
      cancelUrl: site + '/?payment=cancelled',
      failureUrl: site + '/?payment=failed',
      lineItems,
      metadata: {
        orderRef,
        customerName: String(body.name || '').slice(0, 120),
        customerEmail: String(body.email || '').slice(0, 120),
        customerPhone: String(body.phone || '').slice(0, 40),
        deliveryAddress: String(body.address || '').slice(0, 400),
        items: lineItems.map(l => l.displayName + ' x' + l.quantity).join(' | ').slice(0, 900),
      },
    };

    const res = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.YOCO_SECRET_KEY,
        'Idempotency-Key': orderRef,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Yoco checkout failed:', res.status, JSON.stringify(data));
      return json({ error: 'Could not start payment. Please try again.' }, 502);
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

    return json({ redirectUrl: data.redirectUrl, orderRef, amount: totalRand });

  } catch (err) {
    console.error('create-checkout error:', err && err.message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/yoco-webhook                                              */
/* ------------------------------------------------------------------ */

async function signatureValid(headers, rawBody, secret) {
  if (!secret) return null;
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sig = headers.get('webhook-signature');
  if (!id || !ts || !sig) return false;
  try {
    const raw = secret.includes('_') ? secret.split('_')[1] : secret;
    const keyBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign(
      'HMAC', key, new TextEncoder().encode(id + '.' + ts + '.' + rawBody)
    );
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return sig.split(' ').some(part => part.split(',')[1] === expected);
  } catch (e) {
    console.error('signature check error:', e.message);
    return false;
  }
}

async function yocoWebhook(request, env) {
  let raw = '';
  try { raw = await request.text(); } catch (e) { raw = ''; }

  console.log('=== WEBHOOK CALLED ===');
  console.log('body:', raw.slice(0, 2000));

  const valid = await signatureValid(request.headers, raw, env.YOCO_WEBHOOK_SECRET);
  if (valid === false) console.warn('Signature did not verify — continuing so the order is not lost.');
  else if (valid === null) console.warn('YOCO_WEBHOOK_SECRET not set — no verification performed.');
  else console.log('Signature verified.');

  let body = {};
  try { body = JSON.parse(raw || '{}'); } catch (e) {}

  const type = body.type || '';
  const p = body.payload || {};
  const SUCCESS = ['payment.succeeded', 'payment.created', 'checkout.succeeded', 'checkout.completed'];

  if (!SUCCESS.includes(type)) {
    console.log('Not a payment event, ignoring:', type);
    return new Response('OK');
  }

  const md = p.metadata || {};
  const orderRef = md.orderRef || '(no reference)';
  const amount = typeof p.amount === 'number' ? p.amount : 0;

  try {
    const db = await getDb(env);
    await db.collection('orders').updateOne(
      { orderRef },
      { $set: { status: 'paid', paidAt: new Date(), yocoPaymentId: p.id || null } }
    );
    console.log('Order marked paid:', orderRef);
  } catch (e) {
    console.error('could not update order:', e.message);
  }

  if (env.RESEND_API_KEY && env.ORDER_EMAIL) {
    const bodyHtml = `
      <h2>New KORTA order — ${orderRef}</h2>
      <p><strong>Total paid:</strong> ${rands(amount)}</p>
      <h3>Customer</h3>
      <p>${md.customerName || ''}<br>${md.customerEmail || ''}<br>${md.customerPhone || ''}</p>
      <h3>Deliver to</h3>
      <p>${(md.deliveryAddress || '').replace(/\n/g, '<br>')}</p>
      <h3>Items</h3>
      <p>${(md.items || '').split('|').join('<br>')}</p>`;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.ORDER_FROM || 'onboarding@resend.dev',
          to: [env.ORDER_EMAIL],
          subject: 'New order ' + orderRef + ' — ' + rands(amount),
          html: bodyHtml,
        }),
      });
      if (!r.ok) console.error('Resend failed:', r.status, await r.text());
      else console.log('Order email sent.');
    } catch (e) {
      console.error('email error:', e.message);
    }
  } else {
    console.log('ORDER RECEIVED (no email provider):', orderRef, rands(amount), JSON.stringify(md));
  }

  return new Response('OK');
}

/* ------------------------------------------------------------------ */
/* GET /api/import-products   (delete this route after first use)      */
/* ------------------------------------------------------------------ */

async function importProducts(request, env) {
  const url = new URL(request.url);
  if (!env.IMPORT_KEY || url.searchParams.get('key') !== env.IMPORT_KEY) {
    return html('<h1 class="err">Not authorised</h1><p>Add <code>?key=</code> with your IMPORT_KEY.</p>', 401);
  }
  if (!env.MONGODB_URI) return html('<h1 class="err">MONGODB_URI is not set</h1>', 500);

  try {
    const db = await getDb(env);
    const col = db.collection('products');

    await col.createIndex({ sku: 1 }, { unique: true });
    await col.createIndex({ category: 1 });

    let created = 0, updated = 0;
    for (const p of products) {
      const res = await col.updateOne(
        { sku: p.sku },
        {
          $set: {
            name: p.name, slug: p.slug, brand: p.brand, category: p.category,
            description: p.description, specs: p.specs,
            image: p.image, images: p.images, catalogPage: p.catalogPage,
            updatedAt: new Date(),
          },
          // your prices are never overwritten by a re-import
          $setOnInsert: {
            price: p.price, cost: p.cost, stock: p.stock,
            active: p.active, createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      if (res.upsertedCount) created++; else updated++;
    }

    const total = await col.countDocuments();
    const live = await col.countDocuments({ active: true, price: { $gt: 0 } });
    const noPrice = await col.countDocuments({ price: 0 });

    return html(`
      <h1 class="ok">✅ Import complete</h1>
      <div class="box">Created: <strong>${created}</strong><br>
        Updated: <strong>${updated}</strong><br>
        Total in database: <strong>${total}</strong></div>
      <div class="box">Showing on the website: <strong>${live}</strong><br>
        Hidden until priced: <strong>${noPrice}</strong></div>
      <div class="box"><strong>Next</strong><br>
        1. Add prices in Atlas → Browse Collections → korta.products<br>
        2. Set <code>active: true</code> once priced<br>
        3. Remove the import route from worker.js</div>`);

  } catch (err) {
    return html(`<h1 class="err">Import failed</h1>
      <div class="box">${err && err.message}</div>
      <div class="box">If this mentions <code>querySRV</code> or DNS, you are using the
      <code>mongodb+srv://</code> string. In Atlas use Connect → Drivers → Node.js
      <strong>2.2.12 or later</strong> to get the standard string listing hosts directly.</div>`, 500);
  }
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/api/get-products'    && request.method === 'GET')  return await getProducts(request, env);
      if (path === '/api/create-checkout' && request.method === 'POST') return await createCheckout(request, env);
      if (path === '/api/yoco-webhook'    && request.method === 'POST') return await yocoWebhook(request, env);
      if (path === '/api/import-products' && request.method === 'GET')  return await importProducts(request, env);

      // a wrong method on a real endpoint should say so, not fall through to the site
      if (path.startsWith('/api/')) {
        return json({ error: 'Method not allowed' }, 405);
      }
    } catch (err) {
      console.error('router error on ' + path + ':', err && err.message);
      return json({ error: 'Server error' }, 500);
    }

    // everything else is a static file
    return env.ASSETS.fetch(request);
  },
};
