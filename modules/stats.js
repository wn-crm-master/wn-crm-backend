function register(app, getDb, authMiddleware) {
  app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const totalAuthors = await db.collection('authors').countDocuments();
      const totalBooks = await db.collection('books').countDocuments();
      res.json({ totalAuthors, totalBooks });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
