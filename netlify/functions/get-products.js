/**
 * KORTA — get-products
 *
 * Serves the product catalogue from MongoDB to the website.
 *
 * Only returns products marked active with a price above zero, so anything
 * still awaiting a price from the supplier stays hidden.
 *
 * Never returns the cost price — that is yours, not the customer's.
 *
 * Requires environment variable: MONGODB_URI
 */

const { MongoClient } = require('mongodb');

const DB = 'korta';
const COLLECTION = 'products';

// reuse the connection between invocations — much faster than reconnecting
let cached = null;
async function db() {
  if (cached) return cached;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  cached = client.db(DB);
  return cached;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    // let browsers and the CDN cache for 5 minutes, and serve stale while revalidating
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
  };

  try {
    const database = await db();
    const q = event.queryStringParameters || {};

    const filter = { active: true, price: { $gt: 0 } };
    if (q.category) filter.category = q.category;
    if (q.sku)      filter.sku = q.sku;
    if (q.slug)     filter.slug = q.slug;

    const products = await database
      .collection(COLLECTION)
      .find(filter, {
        projection: {
          _id: 0,
          cost: 0,          // never expose what you pay
          catalogPage: 0,
        },
      })
      .sort({ category: 1, price: -1 })
      .limit(500)
      .toArray();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ count: products.length, products }),
    };

  } catch (err) {
    console.error('get-products failed:', err);
    // the site falls back to its bundled copy, so fail quietly rather than loudly
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ count: 0, products: [], error: 'catalogue unavailable' }),
    };
  }
};
