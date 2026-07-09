const { importRecords, isBlankOrError } = require('../import/engine');
const { SPECIAL_FIELDS } = require('./fields');
const { triggerSync } = require('../rollupSync');

function register(app, getDb, authMiddleware) {
  app.post('/api/import/books', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { books = [] } = req.body;
      if (!Array.isArray(books) || books.length === 0)
        return res.status(400).json({ error: 'books array is required' });

      const authorIds = [...new Set(books.map(b => b.authorId).filter(id => id && !isBlankOrError(id)))];
      let stubsCreated = 0;
      if (authorIds.length) {
        const existingAuthors = await db.collection('authors').find({ uid: { $in: authorIds } }, { projection: { uid: 1 } }).toArray();
        const existingSet = new Set(existingAuthors.map(a => a.uid));
        const stubs = authorIds.filter(id => !existingSet.has(id)).map(uid => ({ uid, _stub: true, createdAt: new Date(), updatedAt: new Date() }));
        if (stubs.length) {
          await db.collection('authors').insertMany(stubs, { ordered: false });
          stubsCreated = stubs.length;
        }
      }

      // Auto-derive checkboxes from dates and word count
      for (const b of books) {
        if (b.chp1PublishedDate && !isBlankOrError(b.chp1PublishedDate) && !b.chp1Published) b.chp1Published = true;
        if (b.words10kDate && !isBlankOrError(b.words10kDate) && !b.words10kCompleted) b.words10kCompleted = true;
        if (b.words50kDate && !isBlankOrError(b.words50kDate) && !b.words50kCompleted) b.words50kCompleted = true;
        const wc = typeof b.pubWC === 'number' ? b.pubWC : parseInt(String(b.pubWC || '').replace(/,/g, ''), 10);
        if (!isNaN(wc) && wc >= 10000 && !b.words10kCompleted) b.words10kCompleted = true;
        if (!isNaN(wc) && wc >= 50000 && !b.words50kCompleted) b.words50kCompleted = true;
      }

      for (const b of books) {
        if (b.incentiveFlag === '0' || b.incentiveFlag === 0) b.incentiveFlag = 'Off';
        if (b.incentiveFlag === '1' || b.incentiveFlag === 1) b.incentiveFlag = 'On';
      }

      const result = await importRecords(db, 'books', 'books_backups', books, 'id', SPECIAL_FIELDS);
      triggerSync(db);
      res.json({ success: true, ...result, stubAuthorsCreated: stubsCreated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
