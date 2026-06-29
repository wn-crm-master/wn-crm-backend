function register(app, getDb, authMiddleware) {
  app.get('/api/backups', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const authorBackups = await db.collection('authors_backups')
        .aggregate([{ $group: { _id: '$importId', count: { $sum: 1 }, backedUpAt: { $max: '$backedUpAt' } } }])
        .toArray();
      const bookBackups = await db.collection('books_backups')
        .aggregate([{ $group: { _id: '$importId', count: { $sum: 1 }, backedUpAt: { $max: '$backedUpAt' } } }])
        .toArray();
      res.json({
        authors: authorBackups.map(b => ({ importId: b._id, count: b.count, backedUpAt: b.backedUpAt, entity: 'authors' })),
        books: bookBackups.map(b => ({ importId: b._id, count: b.count, backedUpAt: b.backedUpAt, entity: 'books' }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/backups/restore', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { importId, entity } = req.body;
      if (!importId || !entity) return res.status(400).json({ error: 'importId and entity required' });
      const backupCol = entity === 'authors' ? 'authors_backups' : 'books_backups';
      const liveCol = entity === 'authors' ? 'authors' : 'books';
      const idField = entity === 'authors' ? 'uid' : 'id';
      const records = await db.collection(backupCol).find({ importId }).toArray();
      if (records.length === 0) return res.status(404).json({ error: 'Backup not found or expired' });
      let restored = 0;
      for (const rec of records) {
        const { _id, _originalId, importId: _imp, backedUpAt, ...data } = rec;
        await db.collection(liveCol).replaceOne({ [idField]: data[idField] }, data, { upsert: true });
        restored++;
      }
      res.json({ success: true, restored });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
