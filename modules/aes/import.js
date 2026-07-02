const { isBlankOrError } = require('../import/engine');

function register(app, getDb, authMiddleware) {
  app.post('/api/import/aes', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { aes = [] } = req.body;
      if (!Array.isArray(aes) || aes.length === 0)
        return res.status(400).json({ error: 'aes array is required' });

      let inserted = 0, updated = 0, skipped = 0;
      const today = new Date().toISOString().slice(0, 10);

      for (const record of aes) {
        const email = (record.email || '').trim().toLowerCase();
        if (!email || isBlankOrError(email)) {
          skipped++;
          continue;
        }
        record.email = email;

        const existing = await db.collection('aes').findOne({ email });

        if (!existing) {
          record.dateAdded = today;
          record.createdAt = new Date();
          record.updatedAt = new Date();
          await db.collection('aes').insertOne(record);
          inserted++;
        } else {
          const updateFields = {};
          for (const [key, val] of Object.entries(record)) {
            if (key === '_id' || key === 'dateAdded') continue;
            if (isBlankOrError(val)) continue;
            updateFields[key] = val;
          }
          if (Object.keys(updateFields).length > 0) {
            updateFields.updatedAt = new Date();
            await db.collection('aes').updateOne({ email }, { $set: updateFields });
          }
          updated++;
        }
      }

      res.json({ success: true, inserted, updated, skipped });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
