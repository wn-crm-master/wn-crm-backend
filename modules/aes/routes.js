function register(app, getDb, authMiddleware) {
  app.get('/api/aes', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const today = new Date().toISOString().slice(0, 10);
      const [authEmails, bookEmails, mainAuthorEmails] = await Promise.all([
        db.collection('ae_authors').distinct('aeEmail'),
        db.collection('ae_books').distinct('aeEmail'),
        db.collection('authors').distinct('aeEmail'),
      ]);
      const allEmails = [...new Set([...authEmails, ...bookEmails, ...mainAuthorEmails].map(e => (e || '').trim().toLowerCase()).filter(Boolean))];
      if (allEmails.length) {
        const existing = new Set((await db.collection('aes').find({}, { projection: { email: 1 } }).toArray()).map(d => d.email));
        const missing = allEmails.filter(e => !existing.has(e));
        if (missing.length) {
          await db.collection('aes').insertMany(missing.map(email => ({ email, dateAdded: today, createdAt: new Date(), updatedAt: new Date() })));
        }
      }
      const limit = parseInt(req.query.limit) || 50000;
      const data = await db.collection('aes').find({}).limit(limit).toArray();
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/aes/:email', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { field, value } = req.body;
      if (!field) return res.status(400).json({ error: 'field is required' });
      const update = { [field]: value, updatedAt: new Date() };
      const result = await db.collection('aes').updateOne({ email: req.params.email }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ error: 'AE not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/aes/:email', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      await db.collection('aes').deleteOne({ email: req.params.email });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/aes', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      await db.collection('aes').deleteMany({});
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
