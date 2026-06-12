const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const users = await db.collection('users').find({}).toArray();
    console.log("Users:", users.map(u => ({ email: u.email, tenantId: u.tenantId })));
  } finally {
    await client.close();
  }
}
run().catch(console.error);
