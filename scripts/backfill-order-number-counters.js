const mongoose = require('mongoose');

// Atomic order numbering rollout (PDV-OFF-1): seeds each tenant's `order` counter
// (used by CountersService.next) with the highest `number` already assigned to one
// of its orders, so the next order created continues the existing sequence instead
// of restarting at 1. Idempotent: a tenant that already has a counter row is left
// untouched (its seq only ever moves forward via CountersService.next), so re-running
// after new orders were created is harmless — it never lowers an existing counter.
async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');
    const ordersCol = db.collection('orders');
    const countersCol = db.collection('counters');

    const tenants = await tenantsCol.find({}).toArray();
    console.log(`Found ${tenants.length} tenant(s).`);

    for (const tenant of tenants) {
      const existing = await countersCol.findOne({ tenantId: tenant._id, name: 'order' });
      if (existing) {
        console.log(`[${tenant.slug ?? tenant._id}] counter already exists (seq=${existing.seq}), skipping.`);
        continue;
      }

      const top = await ordersCol
        .find({ tenantId: tenant._id })
        .sort({ number: -1 })
        .limit(1)
        .project({ number: 1 })
        .toArray();
      const maxNumber = typeof top[0]?.number === 'number' ? top[0].number : 0;

      const now = new Date();
      await countersCol.insertOne({
        tenantId: tenant._id,
        name: 'order',
        seq: maxNumber,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`[${tenant.slug ?? tenant._id}] seeded order counter at ${maxNumber}.`);
    }
  } catch (error) {
    console.error('Error backfilling order-number counters:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
