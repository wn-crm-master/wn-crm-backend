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
    const search = req.body?.search || req.query.search;
    const filters = req.body?.filters || (req.query.filters ? JSON.parse(req.query.filters) : null);
    const matchQuery = { uid: { $exists: true, $ne: '' } };
    if (search) { const sr = escapeRegex(search); matchQuery.$or = [
      { name: { $regex: sr, $options: 'i' } },
      { uid: { $regex: sr, $options: 'i' } },
      { email: { $regex: sr, $options: 'i' } }
    ]; }
    if (filters) {
      try {
        const conds = buildFilterConditions(typeof filters === 'string' ? JSON.parse(filters) : filters);
        if (conds.length) matchQuery.$and = [...(matchQuery.$and || []), ...conds];
      } catch (e) {}
    }
    return matchQuery;
  }

  app.post('/api/authors/query', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { page = 1, limit = 1000 } = req.query;
      const matchQuery = buildAuthorsQuery(req);
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const parsedLimit = parseInt(limit);
      const sortField = req.body?.sortField || 'regnDate';
      const sortDir = req.body?.sortDir === 'asc' ? 1 : -1;
      const sortKey = '_sortKey';
      const pipeline = [
        { $match: matchQuery },
        { $addFields: { [sortKey]: { $cond: { if: { $gt: [`$${sortField}`, ''] }, then: `$${sortField}`, else: sortDir === 1 ? '￿' : '0000-00-00' } } } },
        { $sort: { [sortKey]: sortDir } },
        { $skip: skip },
        { $limit: parsedLimit },
        { $project: { [sortKey]: 0 } }
      ];
      const [data, total] = await Promise.all([
        db.collection('authors').aggregate(pipeline).toArray(),
        skip === 0 ? Promise.resolve(null) : db.collection('authors').countDocuments(matchQuery)
      ]);
      const resolvedTotal = total !== null ? total : (data.length < parsedLimit ? data.length : await db.collection('authors').countDocuments(matchQuery));
      const pages = Math.ceil(resolvedTotal / parsedLimit) || 1;
      res.json({ data, total: resolvedTotal, page: parseInt(page), pages });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { page = 1, limit = 1000 } = req.query;
      const matchQuery = buildAuthorsQuery(req);
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const parsedLimit = parseInt(limit);
      const data = await db.collection('authors').find(matchQuery).skip(skip).limit(parsedLimit).toArray();
      const total = (skip === 0 && data.length < parsedLimit)
        ? data.length
        : await db.collection('authors').countDocuments(matchQuery);
      const pages = Math.ceil(total / parsedLimit) || 1;
      res.json({ data, total, page: parseInt(page), pages });
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

  app.post('/api/authors/slim', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const fields = req.body.fields || ['uid', 'aeEmail', 'name', 'email'];
      const projection = { _id: 0 };
      fields.forEach(f => { projection[f] = 1; });
      const cursor = db.collection('authors').find(
        { uid: { $exists: true, $ne: '' } },
        { projection, batchSize: 5000 }
      );
      res.setHeader('Content-Type', 'application/json');
      res.write('{"data":[');
      let first = true;
      for await (const doc of cursor) {
        if (!first) res.write(',');
        res.write(JSON.stringify(doc));
        first = false;
      }
      res.write(']}');
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
