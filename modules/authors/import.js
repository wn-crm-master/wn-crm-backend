const { importRecords, isBlankOrError } = require('../import/engine');
const { SPECIAL_FIELDS, ROLLUP_FIELDS } = require('./fields');
const { triggerSync } = require('../rollupSync');

function register(app, getDb, authMiddleware) {
  app.post('/api/import/authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { authors = [] } = req.body;
      if (!Array.isArray(authors) || authors.length === 0)
        return res.status(400).json({ error: 'authors array is required' });

      // Normalize: treat `id` as `uid` if uid is missing
      const normalized = authors.map(a => {
        if (!a.uid && a.id) { const r = {...a}; r.uid = r.id; delete r.id; return r; }
        return a;
      });

      // Strip computed rollup fields — these are derived from books, not stored
      const cleaned = normalized.map(a => {
        const r = {...a};
        ROLLUP_FIELDS.forEach(f => delete r[f]);
        return r;
      });

      cleaned.forEach(a => {
        if (a.incentiveFlag === '0' || a.incentiveFlag === 0) a.incentiveFlag = 'Off';
        if (a.incentiveFlag === '1' || a.incentiveFlag === 1) a.incentiveFlag = 'On';
      });

      const result = await importRecords(db, 'authors', 'authors_backups', cleaned, 'uid', SPECIAL_FIELDS);
      triggerSync(db);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
