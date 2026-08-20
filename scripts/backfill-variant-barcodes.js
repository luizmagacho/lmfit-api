const mongoose = require('mongoose');

// Loop 35 (etiquetas de produto): mints a real EAN-13 `barcode` (GS1 internal-use "200" prefix
// range — see ProductsService.formatVariantBarcode) for every existing ProductVariant that
// doesn't have one yet, via the same atomic per-tenant `variant-barcode` counter ProductsService
// uses for new variants. Never touches a variant that already has a barcode (manual EAN or
// previously generated). Idempotent: only targets docs with barcode missing, and each counter
// increment is atomic — safe to re-run after new variants were created.

// Same check-digit algorithm as ProductsService.ean13CheckDigit — duplicated here because this
// plain script can't import the TS service directly (same reasoning as the other backfill scripts
// in this directory).
function ean13CheckDigit(twelveDigits) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(twelveDigits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function formatVariantBarcode(seq) {
  const body = `200${String(seq).padStart(9, '0')}`;
  return body + ean13CheckDigit(body);
}

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');
    const variantsCol = db.collection('productvariants');
    const countersCol = db.collection('counters');

    const tenants = await tenantsCol.find({}).toArray();
    console.log(`Found ${tenants.length} tenant(s).`);

    for (const tenant of tenants) {
      const pending = await variantsCol
        .find({
          tenantId: tenant._id,
          $or: [{ barcode: { $exists: false } }, { barcode: null }, { barcode: '' }],
        })
        .sort({ createdAt: 1 })
        .toArray();

      if (pending.length === 0) {
        console.log(`[${tenant.slug ?? tenant._id}] nothing to backfill.`);
        continue;
      }

      let assigned = 0;
      for (const variant of pending) {
        const counter = await countersCol.findOneAndUpdate(
          { tenantId: tenant._id, name: 'variant-barcode' },
          { $inc: { seq: 1 }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true, returnDocument: 'after' },
        );
        const seq = counter.value ? counter.value.seq : counter.seq;
        const barcode = formatVariantBarcode(seq);
        await variantsCol.updateOne(
          { _id: variant._id },
          { $set: { barcode, updatedAt: new Date() } },
        );
        assigned++;
      }
      console.log(`[${tenant.slug ?? tenant._id}] assigned ${assigned} barcode(s).`);
    }
  } catch (error) {
    console.error('Error backfilling variant barcodes:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
