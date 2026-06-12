const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const user = await db.collection('users').findOne({ email: 'admin@kivoni.local' });
    console.log(user);
  } finally {
    await client.close();
  }
}
run().catch(console.error);
