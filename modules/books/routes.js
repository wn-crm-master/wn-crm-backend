function register(app, getDb, authMiddleware) {
  const { triggerSync } = require('../rollupSync');
  app.get('/api/books', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { search, genre, authorId, page = 1, limit = 100, filters } = req.query;
      const query = {};
      if (search) query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { authorName: { $regex: search, $options: 'i' } }
      ];
      if (genre) query.genre = { $regex: genre, $options: 'i' };
      if (authorId) query.authorId = authorId;
      if (filters) {
        try {
          const f = JSON.parse(filters);
          for (const [field, values] of Object.entries(f)) {
            if (!Array.isArray(values) || !values.length) continue;
            const hasBlank = values.includes('');
            const nonBlank = values.filter(v => v !== '');
            const conditions = [];
            if (nonBlank.length) conditions.push({ [field]: { $in: nonBlank } });
            if (hasBlank) conditions.push({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });
            if (conditions.length === 1) Object.assign(query, conditions[0]);
            else query.$and = [...(query.$and || []), { $or: conditions }];
          }
        } catch (e) {}
      }
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const total = await db.collection('books').countDocuments(query);
      const pipeline = [
        ...(Object.keys(query).length ? [{ $match: query }] : []),
        { $lookup: { from: 'authors', localField: 'authorId', foreignField: 'uid', as: '_author' } },
        { $addFields: {
          authorPreContract: { $ifNull: [{ $arrayElemAt: ['$_author.preContractedTag', 0] }, ''] },
          authorPreContractCompany: { $ifNull: [{ $arrayElemAt: ['$_author.preContractCompany', 0] }, ''] },
          authorAeEmail: { $ifNull: [{ $arrayElemAt: ['$_author.aeEmail', 0] }, ''] }
        } },
        { $project: { _author: 0 } },
        { $skip: skip },
        { $limit: parseInt(limit) }
      ];
      const data = await db.collection('books').aggregate(pipeline, { allowDiskUse: true }).toArray();
      res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) || 1 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const AUTHOR_FIELD_MAP = {
    authorPreContract: 'preContractedTag',
    authorPreContractCompany: 'preContractCompany',
    authorAeEmail: 'aeEmail',
  };

  app.get('/api/books/distinct/:field', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const field = req.params.field;
      const authorField = AUTHOR_FIELD_MAP[field];
      const values = authorField
        ? await db.collection('authors').distinct(authorField)
        : await db.collection('books').distinct(field);
      res.json({ values: values.map(v => v == null ? '' : String(v)).sort() });
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

  app.put('/api/books/bulk-update', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { ids = [], field, value } = req.body;
      if (!Array.isArray(ids) || ids.length === 0 || !field) return res.status(400).json({ error: 'ids array and field are required' });
      if (field === '_id' || field === 'id') return res.status(400).json({ error: 'Cannot update id fields' });
      const result = await db.collection('books').updateMany(
        { id: { $in: ids } },
        { $set: { [field]: value, updatedAt: new Date() } }
      );
      triggerSync(db);
      res.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
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
      triggerSync(db);
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
      triggerSync(db);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
