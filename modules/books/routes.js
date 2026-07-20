function register(app, getDb, authMiddleware) {
  const { triggerSync } = require('../rollupSync');
  const { computeBookStage, computeBookUrg, computeCreateMonth } = require('../bookStage');

  function fillComputedFields(books) {
    const now = new Date();
    for (const b of books) {
      if (!b.stage) {
        const s = computeBookStage(b);
        b.stage = s.stage;
        b.stageSince = s.sinceDate || null;
        b.stageImp = s.imp || 'low';
        b.stageUrg = computeBookUrg(s, now);
      }
      if (!b.createMonth) b.createMonth = computeCreateMonth(b.createDate);
    }
    return books;
  }

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

  function buildBooksQuery(req) {
    const search = req.body?.search || req.query.search;
    const genre = req.query.genre;
    const authorId = req.query.authorId;
    const filters = req.body?.filters || (req.query.filters ? JSON.parse(req.query.filters) : null);
    const query = {};
    if (search) { const sr = escapeRegex(search); query.$or = [
      { title: { $regex: sr, $options: 'i' } },
      { authorName: { $regex: sr, $options: 'i' } }
    ]; }
    if (genre) query.genre = { $regex: escapeRegex(genre), $options: 'i' };
    if (authorId) query.authorId = authorId;
    if (filters) {
      try {
        const conds = buildFilterConditions(typeof filters === 'string' ? JSON.parse(filters) : filters);
        if (conds.length) query.$and = [...(query.$and || []), ...conds];
      } catch (e) {}
    }
    return query;
  }

  // Author fields (authorPreContract, authorPreContractCompany, authorAeEmail)
  // are denormalized onto book documents by rollupSync's syncBookAuthorFields,
  // so no $lookup join is needed here — a plain find() is fast even at 50K+ rows.
  app.post('/api/books/query', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { page = 1, limit = 1000 } = req.query;
      const query = buildBooksQuery(req);
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const parsedLimit = parseInt(limit);
      const sortField = req.body?.sortField || 'createDate';
      const sortDir = req.body?.sortDir === 'asc' ? 1 : -1;
      const sortKey = '_sortKey';
      const pipeline = [
        { $match: query },
        { $addFields: { [sortKey]: { $cond: { if: { $gt: [`$${sortField}`, ''] }, then: `$${sortField}`, else: sortDir === 1 ? '￿' : '0000-00-00' } } } },
        { $sort: { [sortKey]: sortDir } },
        { $skip: skip },
        { $limit: parsedLimit },
        { $project: { [sortKey]: 0 } }
      ];
      const [data, total] = await Promise.all([
        db.collection('books').aggregate(pipeline).toArray(),
        skip === 0 ? Promise.resolve(null) : db.collection('books').countDocuments(query)
      ]);
      const resolvedTotal = total !== null ? total : (data.length < parsedLimit ? data.length : await db.collection('books').countDocuments(query));
      const pages = Math.ceil(resolvedTotal / parsedLimit) || 1;
      res.json({ data: fillComputedFields(data), total: resolvedTotal, page: parseInt(page), pages });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/books', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { page = 1, limit = 1000 } = req.query;
      const query = buildBooksQuery(req);
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const parsedLimit = parseInt(limit);
      const data = await db.collection('books').find(query).skip(skip).limit(parsedLimit).toArray();
      const total = (skip === 0 && data.length < parsedLimit)
        ? data.length
        : await db.collection('books').countDocuments(query);
      const pages = Math.ceil(total / parsedLimit) || 1;
      res.json({ data, total, page: parseInt(page), pages });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/books/slim', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const fields = req.body.fields || ['id', 'authorId', 'title'];
      const projection = { _id: 0 };
      fields.forEach(f => { projection[f] = 1; });
      const cursor = db.collection('books').find({}, { projection, batchSize: 5000 });
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

  app.get('/api/books/distinct/:field', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const values = await db.collection('books').distinct(req.params.field);
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
  // materializing the whole dataset as JSON — avoids the timeout/memory
  // issues of paginated JSON fetches for 50K+ row exports.
  app.post('/api/books/export/csv', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const query = buildBooksQuery(req);
      let cols = req.body.cols || null;
      if (!cols) try { cols = JSON.parse(req.query.cols); } catch (e) { cols = null; }
      if (!Array.isArray(cols) || !cols.length) return res.status(400).json({ error: 'cols is required' });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="books_${new Date().toISOString().slice(0,10)}.csv"`);

      const esc = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const projection = { _id: 0 };
      cols.forEach(c => { projection[c.field] = 1; });
      const cursor = db.collection('books').find(query, { projection, batchSize: 5000 });
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
      const computedFields = new Set(['_id', 'id', 'stage', 'stageSince', 'stageImp', 'stageUrg', 'createMonth']);
      if (computedFields.has(field)) return res.status(400).json({ error: 'Cannot update id/computed fields' });
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
      const computedFields = new Set(['_id', 'id', 'stage', 'stageSince', 'stageImp', 'stageUrg', 'createMonth']);
      const updates = {};
      for (const [key, val] of Object.entries(req.body)) {
        if (computedFields.has(key)) continue;
        updates[key] = val;
      }
      if (updates.stageManual !== undefined) updates.stageManualDate = new Date();
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
