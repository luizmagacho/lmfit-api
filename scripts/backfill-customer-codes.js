const mongoose = require('mongoose');

// Loop 34 (carteirinha digital): mints `customerCode` ("CLI-000001") for every
// existing non-walk-in customer that doesn't have one yet, via the same atomic
// per-tenant `customer` counter CustomersService.create() now uses for new
// customers. Idempotent: only touches docs with customerCode missing, and each
// counter increment is atomic — safe to re-run after new customers were created.
async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');
    const customersCol = db.collection('customers');
    const countersCol = db.collection('counters');

    const tenants = await tenantsCol.find({}).toArray();
    console.log(`Found ${tenants.length} tenant(s).`);

    for (const tenant of tenants) {
      const pending = await customersCol
        .find({
          tenantId: tenant._id,
          walkIn: { $ne: true },
          $or: [{ customerCode: { $exists: false } }, { customerCode: null }],
        })
        .sort({ createdAt: 1 })
        .toArray();

      if (pending.length === 0) {
        console.log(`[${tenant.slug ?? tenant._id}] nothing to backfill.`);
        continue;
      }

      let assigned = 0;
      for (const customer of pending) {
        const counter = await countersCol.findOneAndUpdate(
          { tenantId: tenant._id, name: 'customer' },
          { $inc: { seq: 1 }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true, returnDocument: 'after' },
        );
        const seq = counter.value ? counter.value.seq : counter.seq;
        const code = `CLI-${String(seq).padStart(6, '0')}`;
        await customersCol.updateOne(
          { _id: customer._id },
          { $set: { customerCode: code, updatedAt: new Date() } },
        );
        assigned++;
      }
      console.log(`[${tenant.slug ?? tenant._id}] assigned ${assigned} customerCode(s).`);
    }
  } catch (error) {
    console.error('Error backfilling customer codes:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
