const { MongoClient } = require('mongodb');
process.loadEnvFile('.env');
(async () => {
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 12000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DATABASE);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    console.log('Collections:', collections.map(row => row.name).sort());
    for (const { name } of collections.filter(row => /KHACH|NHAN|QUYEN|VAI_TRO|TAI_KHOAN|PHIEN|OTP|NHAT_KY|YEU_CAU_DAT/.test(row.name))) {
      const fields = await db.collection(name).aggregate([
        { $limit: 100 }, { $project: { fields: { $objectToArray: '$$ROOT' } } },
        { $unwind: '$fields' }, { $group: { _id: '$fields.k', types: { $addToSet: { $type: '$fields.v' } } } }
      ]).toArray();
      console.log(JSON.stringify({ name, count: await db.collection(name).countDocuments(), fields }));
    }
  } finally { await client.close(); }
})().catch(error => { console.error(error.name, error.code || 'Connection failed'); process.exit(1); });
