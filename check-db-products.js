const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    
    console.log("Kivoni Products:");
    const kivoni = await db.collection('products').find({ tenantId: new ObjectId('6a285e5fc18fde8e8710301a') }).toArray();
    kivoni.forEach(p => console.log(p.name));
    
    console.log("\nLMFit Products:");
    const lmfit = await db.collection('products').find({ tenantId: new ObjectId('6a285e5fc18fde8e87103018') }).toArray();
    lmfit.forEach(p => console.log(p.name));
    
  } finally {
    await client.close();
  }
}
run().catch(console.error);
