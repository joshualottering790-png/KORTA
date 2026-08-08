/**
 * KORTA — import-products  (RUN ONCE, THEN DELETE)
 *
 * Loads products.json from your repo into MongoDB. Safe to run more than
 * once: it matches on SKU and updates rather than creating duplicates.
 *
 * Visit in a browser:
 *   /.netlify/functions/import-products?key=YOUR_IMPORT_KEY
 *
 * Requires environment variables:
 *   MONGODB_URI
 *   IMPORT_KEY   — any password you choose, so nobody else can trigger this
 *
 * DELETE THIS FILE once your products are in.
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  const html = (b) => `<!doctype html><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#111;color:#eee;
    padding:26px;max-width:640px;margin:0 auto;line-height:1.6}
    .box{background:#1c1c1c;border:1px solid #333;border-radius:12px;padding:16px;margin:14px 0}
    .ok{color:#7CF0B0}.err{color:#ff8080}code{background:#000;padding:2px 6px;border-radius:4px}</style>${b}`;

  const key = (event.queryStringParameters || {}).key;
  if (!process.env.IMPORT_KEY || key !== process.env.IMPORT_KEY) {
    return { statusCode: 401, headers: {'Content-Type':'text/html'},
             body: html('<h1 class="err">Not authorised</h1><p>Add <code>?key=</code> with your IMPORT_KEY.</p>') };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return { statusCode: 500, headers: {'Content-Type':'text/html'},
             body: html('<h1 class="err">MONGODB_URI is not set</h1>') };
  }

  let client;
  try {
    // products.json sits at the repo root and is bundled with the function
    const file = path.join(__dirname, 'products.json');
    const products = JSON.parse(fs.readFileSync(file, 'utf8'));

    client = new MongoClient(uri);
    await client.connect();
    const col = client.db('korta').collection('products');

    await col.createIndex({ sku: 1 }, { unique: true });
    await col.createIndex({ category: 1 });
    await col.createIndex({ slug: 1 });

    let created = 0, updated = 0;
    for (const p of products) {
      const res = await col.updateOne(
        { sku: p.sku },
        {
          // price, cost, stock and active are yours to manage in the database,
          // so only set them when the record is first created
          $set: {
            name: p.name, slug: p.slug, brand: p.brand, category: p.category,
            description: p.description, specs: p.specs,
            image: p.image, images: p.images, catalogPage: p.catalogPage,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            price: p.price, cost: p.cost, stock: p.stock,
            active: p.active, createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      if (res.upsertedCount) created++; else updated++;
    }

    const total   = await col.countDocuments();
    const live    = await col.countDocuments({ active: true, price: { $gt: 0 } });
    const noPrice = await col.countDocuments({ price: 0 });

    return {
      statusCode: 200, headers: {'Content-Type':'text/html'},
      body: html(`
        <h1 class="ok">✅ Import complete</h1>
        <div class="box">
          Created: <strong>${created}</strong><br>
          Updated: <strong>${updated}</strong><br>
          Total in database: <strong>${total}</strong>
        </div>
        <div class="box">
          Showing on the website: <strong>${live}</strong><br>
          Hidden (no price yet): <strong>${noPrice}</strong>
        </div>
        <div class="box">
          <strong>Next</strong><br>
          1. Add prices in MongoDB Atlas → Browse Collections<br>
          2. Set <code>active: true</code> once priced<br>
          3. <strong>Delete import-products.js from your repo</strong>
        </div>`),
    };

  } catch (err) {
    console.error('import failed:', err);
    return { statusCode: 500, headers: {'Content-Type':'text/html'},
             body: html(`<h1 class="err">Import failed</h1><div class="box">${err.message}</div>`) };
  } finally {
    if (client) await client.close();
  }
};
