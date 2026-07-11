const mongoose = require('mongoose');

// Multi-location stock rollout: creates a "Loja Principal" default location for every
// tenant and mirrors each variant's current quantityOnHand into a StockLevel row there.
// Idempotent: a variant already present in `stocklevels` for its tenant's default
// location is left untouched, so re-running after new sales/purchases is harmless.
async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');
    const locationsCol = db.collection('locations');
    const stockLevelsCol = db.collection('stocklevels');
    const variantsCol = db.collection('productvariants');

    const tenants = await tenantsCol.find({}).toArray();
    console.log(`Found ${tenants.length} tenant(s).`);

    for (const tenant of tenants) {
      let defaultLocation = await locationsCol.findOne({
        tenantId: tenant._id,
        isDefault: true,
      });
      if (!defaultLocation) {
        const now = new Date();
        const res = await locationsCol.insertOne({
          tenantId: tenant._id,
          name: 'Loja Principal',
          isDefault: true,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
        defaultLocation = { _id: res.insertedId };
        console.log(`[${tenant.slug ?? tenant._id}] created default location ${res.insertedId}`);
      }

      const variants = await variantsCol
        .find({ tenantId: tenant._id })
        .project({ _id: 1, quantityOnHand: 1 })
        .toArray();

      let migrated = 0;
      for (const v of variants) {
        const existing = await stockLevelsCol.findOne({
          tenantId: tenant._id,
          variantId: v._id,
          locationId: defaultLocation._id,
        });
        if (existing) continue;
        const now = new Date();
        await stockLevelsCol.insertOne({
          tenantId: tenant._id,
          variantId: v._id,
          locationId: defaultLocation._id,
          quantity: typeof v.quantityOnHand === 'number' ? v.quantityOnHand : 0,
          createdAt: now,
          updatedAt: now,
        });
        migrated++;
      }
      console.log(
        `[${tenant.slug ?? tenant._id}] ${variants.length} variant(s), ${migrated} stock level row(s) created.`,
      );
    }
  } catch (error) {
    console.error('Error migrating stock to locations:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
