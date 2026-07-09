function register(app, getDb, authMiddleware) {
  const { triggerSync } = require('../rollupSync');
  const AUTHOR_FIELD_MAP = {
    authorPreContract: 'preContractedTag',
    authorPreContractCompany: 'preContractCompany',
    authorAeEmail: 'aeEmail',
  };

  function buildFilterConditions(f) {
    const conditions = [];
    for (const [field, values] of Object.entries(f)) {
      if (!Array.isArray(values) || !values.length) continue;
      const hasBlank = values.includes('');
      const nonBlank = values.filter(v => v !== '');
      const orConds = [];
      if (nonBlank.length) orConds.push({ [field]: { $in: nonBlank } });
      if (hasBlank) orConds.push({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });
      conditions.push(orConds.length === 1 ? orConds[0] : { $or: orConds });
    }
    return conditions;
  }

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

      let bookFilterConds = [];
      let lookupFilterConds = [];
      if (filters) {
        try {
          const f = JSON.parse(filters);
          const bookFilters = {};
          const lookupFilters = {};
          for (const [field, values] of Object.entries(f)) {
            if (AUTHOR_FIELD_MAP[field]) lookupFilters[field] = values;
            else bookFilters[field] = values;
          }
          bookFilterConds = buildFilterConditions(bookFilters);
          lookupFilterConds = buildFilterConditions(lookupFilters);
        } catch (e) {}
      }
      if (bookFilterConds.length) query.$and = [...(query.$and || []), ...bookFilterConds];

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const pipeline = [
        ...(Object.keys(query).length ? [{ $match: query }] : []),
        { $lookup: { from: 'authors', localField: 'authorId', foreignField: 'uid', as: '_author' } },
        { $addFields: {
          authorPreContract: { $ifNull: [{ $arrayElemAt: ['$_author.preContractedTag', 0] }, ''] },
          authorPreContractCompany: { $ifNull: [{ $arrayElemAt: ['$_author.preContractCompany', 0] }, ''] },
          authorAeEmail: { $ifNull: [{ $arrayElemAt: ['$_author.aeEmail', 0] }, ''] }
        } },
        { $project: { _author: 0 } },
        ...(lookupFilterConds.length ? [{ $match: { $and: lookupFilterConds } }] : []),
      ];
      const countPipeline = [...pipeline, { $count: 'total' }];
      const dataPipeline = [...pipeline, { $skip: skip }, { $limit: parseInt(limit) }];
      const [countResult, data] = await Promise.all([
        db.collection('books').aggregate(countPipeline, { allowDiskUse: true }).toArray(),
        db.collection('books').aggregate(dataPipeline, { allowDiskUse: true }).toArray()
      ]);
      const total = countResult[0]?.total || 0;
      res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) || 1 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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
