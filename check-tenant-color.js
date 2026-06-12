const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const kivoni = await db.collection('tenants').findOne({ _id: new ObjectId('6a285e5fc18fde8e8710301a') });
    console.log(kivoni.branding);
  } finally {
    await client.close();
  }
}
run().catch(console.error);
