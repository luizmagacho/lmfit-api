const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lmfit';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');

    const lmfit = await tenantsCol.findOne({ slug: 'lmfit' });
    if (!lmfit) {
      console.log("lmfit tenant not found in DB. Seeding it...");
      await tenantsCol.insertOne({
        slug: 'lmfit',
        name: 'LM FIT',
        active: true,
        branding: {
          logoUrl: 'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
          faviconUrl: 'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
          primaryColor: '#f68006',
          secondaryColor: '#000000',
          darkMode: false,
        },
        plan: 'enterprise',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log("Seeded lmfit successfully.");
    } else {
      console.log("Updating lmfit branding details...");
      await tenantsCol.updateOne(
        { slug: 'lmfit' },
        {
          $set: {
            'branding.logoUrl': 'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
            'branding.faviconUrl': 'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
            'branding.primaryColor': '#f68006',
            'branding.secondaryColor': '#000000',
          }
        }
      );
      console.log("Updated lmfit branding successfully.");
    }
  } catch (error) {
    console.error('Error updating lmfit:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
