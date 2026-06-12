const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');

    const tenant = await tenantsCol.findOne({ slug: 'kivoni' });
    if (!tenant) {
      console.error("kivoni tenant not found in DB! Seed must be run first.");
      process.exit(1);
    }

    const tenantId = tenant._id;
    console.log(`Resolved kivoni tenant ID: ${tenantId}`);

    const collections = [
      'users',
      'refreshtokens',
      'customers',
      'orders',
      'products',
      'productvariants',
      'stockledgers',
      'invoices',
      'purchases',
      'suppliers',
      'lowstockalerts',
      'whatsappmessages',
      'whatsappsenders',
      'payments',
      'orderdrafts',
      'cashflowentries',
      'productionbatches'
    ];

    for (const colName of collections) {
      const col = db.collection(colName);
      // Update documents where tenantId is missing/undefined/null
      const result = await col.updateMany(
        { $or: [ { tenantId: { $exists: false } }, { tenantId: null } ] },
        { $set: { tenantId: tenantId } }
      );
      console.log(`Collection '${colName}': updated ${result.modifiedCount} documents.`);
    }

    console.log("🎉 Database fixed successfully!");
  } catch (error) {
    console.error('Error fixing database:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
