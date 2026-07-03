function register(app, getDb, authMiddleware) {
  // ae_authors
  app.get('/api/ae-authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const col = db.collection('ae_authors');
      const all = await col.find({}).toArray();
      const seen = new Set();
      const toDelete = [];
      for (const doc of all) {
        const key = ((doc.aeEmail || '').trim().toLowerCase()) + '|' + ((doc.uid || '').trim());
        if (seen.has(key)) {
          toDelete.push(doc._id);
        } else {
          seen.add(key);
        }
      }
      if (toDelete.length) await col.deleteMany({ _id: { $in: toDelete } });

      // Auto-sync: create ae_authors mappings from main authors' aeEmail field
      const authorsWithAe = await db.collection('authors').find(
        { aeEmail: { $exists: true, $nin: [null, ''] } },
        { projection: { uid: 1, aeEmail: 1 } }
      ).toArray();
      if (authorsWithAe.length) {
        const existingKeys = new Set(
          (await col.find({}, { projection: { aeEmail: 1, uid: 1 } }).toArray())
            .map(d => ((d.aeEmail || '').trim().toLowerCase()) + '|' + ((d.uid || '').trim()))
        );
        const toInsert = [];
        for (const a of authorsWithAe) {
          const aeEmail = (a.aeEmail || '').trim().toLowerCase();
          const uid = (a.uid || '').trim();
          if (!aeEmail || !uid) continue;
          const key = aeEmail + '|' + uid;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            toInsert.push({ aeEmail, uid, createdAt: new Date() });
          }
        }
        if (toInsert.length) await col.insertMany(toInsert);
      }

      const limit = parseInt(req.query.limit) || 50000;
      const data = await col.find({}).limit(limit).toArray();
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ae-authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      await db.collection('ae_authors').deleteMany({});
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ae_books
  app.get('/api/ae-books', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const limit = parseInt(req.query.limit) || 50000;
      const data = await db.collection('ae_books').find({}).limit(limit).toArray();
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ae-books', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      await db.collection('ae_books').deleteMany({});
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ae_payments
  app.get('/api/ae-payments', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const limit = parseInt(req.query.limit) || 50000;
      const data = await db.collection('ae_payments').find({}).limit(limit).toArray();
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ae-payments', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      await db.collection('ae_payments').deleteMany({});
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
