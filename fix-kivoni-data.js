const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    
    const kivoniTenantId = new ObjectId('6a285e5fc18fde8e8710301a');
    
    // Find all products in Kivoni that are NOT football shirts
    const fitnessProducts = await db.collection('products').find({
      tenantId: kivoniTenantId,
      tags: { $ne: 'futebol' }
    }).toArray();
    
    console.log(`Found ${fitnessProducts.length} fitness products to delete from Kivoni.`);
    
    if (fitnessProducts.length > 0) {
      const fitnessIds = fitnessProducts.map(p => p._id);
      
      // Delete their variants
      const vRes = await db.collection('productvariants').deleteMany({ productId: { $in: fitnessIds } });
      console.log(`Deleted ${vRes.deletedCount} fitness variants.`);
      
      // Delete the products
      const pRes = await db.collection('products').deleteMany({ _id: { $in: fitnessIds } });
      console.log(`Deleted ${pRes.deletedCount} fitness products.`);
    }
    
    console.log("Cleanup complete!");
    
  } finally {
    await client.close();
  }
}
run().catch(console.error);
