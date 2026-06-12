const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const kivoniCount = await db.collection('products').countDocuments({ tenantId: new ObjectId('6a285e5fc18fde8e8710301a') });
    const lmfitCount = await db.collection('products').countDocuments({ tenantId: new ObjectId('6a285e5fc18fde8e87103018') });
    console.log(`Kivoni products: ${kivoniCount}`);
    console.log(`LMFit products: ${lmfitCount}`);
    
    const noTenant = await db.collection('products').countDocuments({ tenantId: { $exists: false } });
    console.log(`No tenantId products: ${noTenant}`);
  } finally {
    await client.close();
  }
}
run().catch(console.error);
