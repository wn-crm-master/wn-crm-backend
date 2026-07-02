function register(app, getDb, authMiddleware) {
  // ae_authors
  app.get('/api/ae-authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const limit = parseInt(req.query.limit) || 50000;
      const data = await db.collection('ae_authors').find({}).limit(limit).toArray();
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
