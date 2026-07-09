function register(app, getDb, authMiddleware) {
  const { triggerSync } = require('../rollupSync');

  app.get('/api/authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { search, page = 1, limit = 100, filters } = req.query;
      const matchQuery = { uid: { $exists: true, $ne: '' } };
      if (search) matchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { uid: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
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
            if (conditions.length === 1) Object.assign(matchQuery, conditions[0]);
            else matchQuery.$and = [...(matchQuery.$and || []), { $or: conditions }];
          }
        } catch (e) {}
      }
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [total, data] = await Promise.all([
        db.collection('authors').countDocuments(matchQuery),
        db.collection('authors').find(matchQuery).skip(skip).limit(parseInt(limit)).toArray()
      ]);
      res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) || 1 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/authors/distinct/:field', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const values = await db.collection('authors').distinct(req.params.field, { uid: { $exists: true, $ne: '' } });
      res.json({ values: values.map(v => v == null ? '' : String(v)).sort() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/authors/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const author = await db.collection('authors').findOne({ uid: req.params.id });
      if (!author) return res.status(404).json({ error: 'Author not found' });
      res.json(author);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/authors/bulk-update', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { ids = [], field, value } = req.body;
      if (!Array.isArray(ids) || ids.length === 0 || !field) return res.status(400).json({ error: 'ids array and field are required' });
      if (field === '_id' || field === 'uid') return res.status(400).json({ error: 'Cannot update id fields' });
      const result = await db.collection('authors').updateMany(
        { uid: { $in: ids } },
        { $set: { [field]: value, updatedAt: new Date() } }
      );
      triggerSync(db);
      res.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/authors/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const existing = await db.collection('authors').findOne({ uid: req.params.id });
      if (!existing) return res.status(404).json({ error: 'Author not found' });
      const updates = {};
      for (const [key, val] of Object.entries(req.body)) {
        if (key === '_id' || key === 'uid') continue;
        updates[key] = val;
      }
      if (Object.keys(updates).length === 0) return res.json({ success: true, message: 'Nothing to update' });
      const { _id: aId, ...authData } = existing;
      await db.collection('authors_backups').insertOne({ ...authData, _originalId: aId, importId: 'direct-edit', backedUpAt: new Date() });
      await db.collection('authors').updateOne({ uid: req.params.id }, { $set: { ...updates, updatedAt: new Date() } });
      triggerSync(db);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/authors/all', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const result = await db.collection('authors').deleteMany({});
      res.json({ success: true, deleted: result.deletedCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/authors/:id', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const result = await db.collection('authors').deleteOne({ uid: req.params.id });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Author not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
