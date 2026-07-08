const mongoose = require('mongoose');

// Backfills tenantId on material documents created before the field existed.
// Target tenant resolution: TENANT_ID env var, then TENANT_SLUG env var,
// then automatic if the database has exactly one tenant.
async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');

    let tenant;
    if (process.env.TENANT_ID) {
      tenant = await tenantsCol.findOne({
        _id: new mongoose.Types.ObjectId(process.env.TENANT_ID),
      });
      if (!tenant) {
        console.error(`Tenant not found for TENANT_ID=${process.env.TENANT_ID}`);
        process.exit(1);
      }
    } else if (process.env.TENANT_SLUG) {
      tenant = await tenantsCol.findOne({ slug: process.env.TENANT_SLUG });
      if (!tenant) {
        console.error(`Tenant not found for TENANT_SLUG=${process.env.TENANT_SLUG}`);
        process.exit(1);
      }
    } else {
      const tenants = await tenantsCol.find({}).toArray();
      if (tenants.length !== 1) {
        console.error(
          `Found ${tenants.length} tenants. Set TENANT_ID or TENANT_SLUG to pick the backfill target.`,
        );
        process.exit(1);
      }
      tenant = tenants[0];
    }

    console.log(`Resolved tenant: ${tenant.slug ?? ''} (${tenant._id})`);

    const result = await db.collection('materials').updateMany(
      { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
      { $set: { tenantId: tenant._id } },
    );
    console.log(`Collection 'materials': updated ${result.modifiedCount} documents.`);
  } catch (error) {
    console.error('Error backfilling materials:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
