function register(app, getDb, authMiddleware) {
  app.get('/api/books', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { search, genre, authorId, page = 1, limit = 100 } = req.query;
      const query = {};
      if (search) query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { authorName: { $regex: search, $options: 'i' } }
      ];
      if (genre) query.genre = { $regex: genre, $options: 'i' };
      if (authorId) query.authorId = authorId;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const total = await db.collection('books').countDocuments(query);
      const pipeline = [
        ...(Object.keys(query).length ? [{ $match: query }] : []),
        { $lookup: { from: 'authors', localField: 'authorId', foreignField: 'uid', as: '_author' } },
        { $addFields: { authorPreContract: { $ifNull: [{ $arrayElemAt: ['$_author.preContractedTag', 0] }, ''] } } },
        { $project: { _author: 0 } },
        { $skip: skip },
        { $limit: parseInt(limit) }
      ];
      const data = await db.collection('books').aggregate(pipeline).toArray();
      res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) || 1 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/books/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const book = await db.collection('books').findOne({ id: req.params.id });
      if (!book) return res.status(404).json({ error: 'Book not found' });
      res.json(book);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/books/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const existing = await db.collection('books').findOne({ id: req.params.id });
      if (!existing) return res.status(404).json({ error: 'Book not found' });
      const updates = {};
      for (const [key, val] of Object.entries(req.body)) {
        if (key === '_id' || key === 'id') continue;
        updates[key] = val;
      }
      if (Object.keys(updates).length === 0) return res.json({ success: true, message: 'Nothing to update' });
      const { _id: bId, ...bookData } = existing;
      await db.collection('books_backups').insertOne({ ...bookData, _originalId: bId, importId: 'direct-edit', backedUpAt: new Date() });
      await db.collection('books').updateOne({ id: req.params.id }, { $set: { ...updates, updatedAt: new Date() } });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/books/all', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const result = await db.collection('books').deleteMany({});
      res.json({ success: true, deleted: result.deletedCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/books/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const result = await db.collection('books').deleteOne({ id: req.params.id });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Book not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
