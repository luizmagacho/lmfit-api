const mongoose = require('mongoose');
require('dotenv').config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");
  
  const tenants = await mongoose.connection.db.collection('tenants').find({}).toArray();
  console.log("Tenants:");
  console.log(JSON.stringify(tenants, null, 2));
  
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
