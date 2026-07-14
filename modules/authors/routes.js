function register(app, getDb, authMiddleware) {
  const { triggerSync } = require('../rollupSync');

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function buildFilterConditions(f) {
    const conditions = [];
    for (const [field, values] of Object.entries(f)) {
      if (!Array.isArray(values) || !values.length) continue;
      const hasBlank = values.includes('');
      const nonBlank = values.filter(v => v !== '');
      const orConds = [];
      if (nonBlank.length) {
        const inVals = [];
        for (const v of nonBlank) {
          const t = v.trim();
          inVals.push(t);
          const n = Number(t);
          if (t !== '' && !isNaN(n)) inVals.push(n);
          if (t.toLowerCase() === 'true') inVals.push(true);
          if (t.toLowerCase() === 'false') inVals.push(false);
        }
        const pattern = '^(' + nonBlank.map(v => escapeRegex(v.trim())).join('|') + ')$';
        orConds.push({ $or: [
          { [field]: { $in: inVals } },
          { [field]: { $regex: pattern, $options: 'i' } }
        ]});
      }
      if (hasBlank) orConds.push({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });
      conditions.push(orConds.length === 1 ? orConds[0] : { $or: orConds });
    }
    return conditions;
  }

  function buildAuthorsQuery(req) {
    const { search, filters } = req.query;
    const matchQuery = { uid: { $exists: true, $ne: '' } };
    if (search) matchQuery.$or = [
      { name: { $regex: search, $options: 'i' } },
      { uid: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
    if (filters) {
      try {
        const conds = buildFilterConditions(JSON.parse(filters));
        if (conds.length) matchQuery.$and = [...(matchQuery.$and || []), ...conds];
      } catch (e) {}
    }
    return matchQuery;
  }

  app.post('/api/authors/query', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { page = 1, limit = 100 } = req.query;
      req.query.filters = req.body.filters ? JSON.stringify(req.body.filters) : req.query.filters;
      req.query.search = req.body.search || req.query.search;
      const matchQuery = buildAuthorsQuery(req);
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

  app.get('/api/authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { page = 1, limit = 100 } = req.query;
      const matchQuery = buildAuthorsQuery(req);
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
      const seen = new Map();
      for (const v of values) {
        const str = v == null ? '' : String(v).trim();
        const key = str.toLowerCase();
        if (!seen.has(key) || (seen.get(key) === '' && str !== '')) seen.set(key, str);
      }
      res.json({ values: [...seen.values()].sort() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Streams the full (filtered) result set directly as CSV, without ever
  // materializing the whole dataset as JSON.
  app.post('/api/authors/export/csv', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      if (req.body.filters) req.query.filters = JSON.stringify(req.body.filters);
      if (req.body.search) req.query.search = req.body.search;
      const matchQuery = buildAuthorsQuery(req);
      let cols = req.body.cols || null;
      if (!cols) try { cols = JSON.parse(req.query.cols); } catch (e) { cols = null; }
      if (!Array.isArray(cols) || !cols.length) return res.status(400).json({ error: 'cols is required' });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="authors_${new Date().toISOString().slice(0,10)}.csv"`);

      const esc = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const projection = { _id: 0 };
      cols.forEach(c => { projection[c.field] = 1; });
      const cursor = db.collection('authors').find(matchQuery, { projection, batchSize: 5000 });
      res.write(cols.map(c => esc(c.header)).join(',') + '\n');
      let buf = [];
      for await (const row of cursor) {
        buf.push(cols.map(c => esc(row[c.field] ?? '')).join(','));
        if (buf.length >= 500) { res.write(buf.join('\n') + '\n'); buf = []; }
      }
      if (buf.length) res.write(buf.join('\n') + '\n');
      res.end();
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
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
