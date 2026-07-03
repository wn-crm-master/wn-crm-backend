function register(app, getDb, authMiddleware) {
  const TRUTHY_VALS = [true, 1, 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes', 'y', 'Y', '1'];

  app.get('/api/authors', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { search, page = 1, limit = 100 } = req.query;
      const matchQuery = { uid: { $exists: true, $ne: '' } };
      if (search) matchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { uid: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const total = await db.collection('authors').countDocuments(matchQuery);

      const pipeline = [
        ...(Object.keys(matchQuery).length ? [{ $match: matchQuery }] : []),
        { $lookup: { from: 'books', localField: 'uid', foreignField: 'authorId', as: '_books' } },
        { $addFields: {
          booksCreated:           { $size: '$_books' },
          booksChp1Published:     { $size: { $filter: { input: '$_books', cond: { $in: ['$$this.chp1Published',     TRUTHY_VALS] } } } },
          books10kCompleted:      { $size: { $filter: { input: '$_books', cond: { $in: ['$$this.words10kCompleted', TRUTHY_VALS] } } } },
          booksModPassed:         { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.moderationStatus',''] } }, regex: 'pass'    } } } } },
          booksExpressContracted: { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpStatus',       ''] } }, regex: 'express' } } } } },
          booksWBPContracted:     { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpStatus',       ''] } }, regex: 'wbp'     } } } } },
          booksOFW:               { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpSubStatus',    ''] } }, regex: 'open.?for.?withdrawal|\\bofw\\b' } } } } },
          firstContractDate:      { $let: {
            vars: { dates: { $filter: { input: '$_books', cond: { $and: [
              { $ne: ['$$this.contractSigningDate', null] },
              { $ne: ['$$this.contractSigningDate', ''] }
            ] } } } },
            in: { $cond: { if: { $gt: [{ $size: '$$dates' }, 0] }, then: { $min: { $map: { input: '$$dates', in: '$$this.contractSigningDate' } } }, else: null } }
          }}
        }},
        { $project: { _books: 0 } },
        { $skip: skip },
        { $limit: parseInt(limit) }
      ];

      const data = await db.collection('authors').aggregate(pipeline).toArray();
      res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) || 1 });
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
