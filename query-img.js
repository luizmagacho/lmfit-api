const { MongoClient } = require("mongodb");
require("dotenv").config();
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const p = await db.collection("products").findOne({ $or: [{ primaryImageUrl: { $exists: true } }, { imageUrl: { $exists: true } }, { "images.0": { $exists: true } }] });
  console.log(JSON.stringify(p, null, 2));
  client.close();
})();
