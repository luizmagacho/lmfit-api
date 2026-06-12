const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  await mongoose.connect(uri);

  try {
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');

    const tenant = await tenantsCol.findOne({ slug: 'kivoni' });
    if (!tenant) {
      console.log("kivoni tenant not found in DB. Seeding it...");
      await tenantsCol.insertOne({
        slug: 'kivoni',
        name: 'Kivoni Store',
        active: true,
        branding: {
          logoUrl: '/kivoni-logo.png',
          faviconUrl: '/kivoni-logo.png',
          primaryColor: '#7c3aed',
          secondaryColor: '#06b6d4',
          darkMode: false,
        },
        plan: 'enterprise',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log("Seeded kivoni successfully.");
    } else {
      console.log("Updating kivoni branding details...");
      await tenantsCol.updateOne(
        { slug: 'kivoni' },
        {
          $set: {
            name: 'Kivoni Store',
            'branding.logoUrl': '/kivoni-logo.png',
            'branding.faviconUrl': '/kivoni-logo.png',
            'branding.primaryColor': '#7c3aed',
            'branding.secondaryColor': '#06b6d4',
          }
        }
      );
      console.log("Updated kivoni branding successfully.");
    }
  } catch (error) {
    console.error('Error updating kivoni:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
