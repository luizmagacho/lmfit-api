const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const tenants = await db.collection('tenants').find({}).toArray();
    console.log("Tenants found:", tenants.map(t => ({ _id: t._id, slug: t.slug, name: t.name })));
  } finally {
    await client.close();
  }
}
run().catch(console.error);
