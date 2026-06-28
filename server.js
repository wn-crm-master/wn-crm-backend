require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'wn-crm-secret-change-in-production';

// Special Fields — changing these on an existing record requires user approval before overwrite.
const SPECIAL_FIELDS_AUTHORS = [
  'name',              // Author Name
  'regnDate',          // Author Reg. Date
  'locale',            // Author Locale
  'email',             // Author Email ID
  'phone',             // Author Phone No.
  'bucketTag',         // Bucket Tag
  'contestTag',        // Contest Tag
  'sourceTag',         // Source Tag
  'authorTypeTag',     // Author Type Tag
  'preContractedTag',  // Pre-Contract Validation
  'preContractCompany' // Pre-Contract Company
];
const SPECIAL_FIELDS_BOOKS = [
  'authorId',    // Author ID
  'title',       // Book Title
  'showId',      // Show ID
  'showTitle',   // Show Title
  'createDate',  // Book Create Date
  'status'       // Book Status
];

// Values that must never overwrite existing data
const REJECT_VALUES = new Set(['', 'null', 'undefined', 'n/a', '#error', '#ref!']);
function isBlankOrError(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  return s === '' || REJECT_VALUES.has(s.toLowerCase());
}

let db;

MongoClient.connect(MONGO_URI)
  .then(client => {
    console.log('Connected to MongoDB Atlas');
    db = client.db('author-books-db');
    db.collection('authors').createIndex({ uid: 1 }, { unique: true, sparse: true }).catch(() => {});
    // Drop the wrong id_1 index on authors if it exists from a previous version
    db.collection('authors').dropIndex('id_1').catch(() => {});
    db.collection('books').createIndex({ id: 1 }, { unique: true }).catch(() => {});
    db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(() => {});
    db.collection('authors_backups').createIndex({ backedUpAt: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
    db.collection('books_backups').createIndex({ backedUpAt: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Core import function used by both authors and books
async function importRecords(collection, backupCollection, records, idField, specialFields) {
  const importId = crypto.randomBytes(6).toString('hex');
  let inserted = 0, updated = 0, skipped = 0;
  const skippedReasons = [];
  const specialFieldChanges = [];

  for (const record of records) {
    const uid = record[idField];

    // Reject records with no unique ID
    if (!uid || isBlankOrError(uid)) {
      skipped++;
      skippedReasons.push({ id: null, reason: 'Missing unique ID' });
      continue;
    }

    const existing = await db.collection(collection).findOne({ [idField]: uid });

    if (!existing) {
      // New record — insert directly
      await db.collection(collection).insertOne({ ...record, createdAt: new Date(), updatedAt: new Date() });
      inserted++;
    } else {
      // Backup existing record before any overwrite
      await db.collection(backupCollection).insertOne({
        ...existing,
        _originalId: existing._id,
        importId,
        backedUpAt: new Date()
      });

      // Build the update object respecting blank/error and special field rules
      const updateFields = {};
      let allBlank = true;

      for (const [key, newVal] of Object.entries(record)) {
        if (key === '_id') continue;
        if (isBlankOrError(newVal)) continue; // Rule 1 & 2: skip blanks/errors

        allBlank = false;

        if (specialFields.includes(key) && existing[key] !== undefined && existing[key] !== newVal) {
          // Special field changed — flag for approval, don't write yet
          specialFieldChanges.push({
            importId,
            entityId: uid,
            field: key,
            oldValue: existing[key],
            newValue: newVal,
            status: 'pending_approval'
          });
        } else {
          updateFields[key] = newVal;
        }
      }

      if (allBlank) {
        skipped++;
        skippedReasons.push({ id: uid, reason: 'All incoming fields were blank or error values' });
        continue;
      }

      if (Object.keys(updateFields).length > 0) {
        updateFields.updatedAt = new Date();
        await db.collection(collection).updateOne({ [idField]: uid }, { $set: updateFields });
      }

      updated++;
    }
  }

  // Store pending special field changes for approval
  if (specialFieldChanges.length > 0) {
    await db.collection('pending_approvals').insertMany(specialFieldChanges);
  }

  return { importId, inserted, updated, skipped, skippedReasons, specialFieldChanges };
}

// ============ HEALTH ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: db ? 'connected' : 'disconnected' });
});

// ============ AUTH ============
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const existing = await db.collection('users').findOne({ email });
    if (existing) return res.status(400).json({ error: 'User already exists' });
    const hash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({ email, password: hash, name, createdAt: new Date() });
    const token = jwt.sign({ userId: result.insertedId, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: result.insertedId, email, name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.collection('users').findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ IMPORT — AUTHORS ============
app.post('/api/import/authors', authMiddleware, async (req, res) => {
  try {
    const { authors = [] } = req.body;
    if (!Array.isArray(authors) || authors.length === 0)
      return res.status(400).json({ error: 'authors array is required' });

    // Strip computed rollup fields — these are derived from books, not stored
    const cleaned = authors.map(a => { const r={...a}; ROLLUP_AUTHOR_FIELDS.forEach(f=>delete r[f]); return r; });
    const result = await importRecords('authors', 'authors_backups', cleaned, 'uid', SPECIAL_FIELDS_AUTHORS);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ IMPORT — BOOKS ============
app.post('/api/import/books', authMiddleware, async (req, res) => {
  try {
    const { books = [] } = req.body;
    if (!Array.isArray(books) || books.length === 0)
      return res.status(400).json({ error: 'books array is required' });

    // Auto-create stub author entries for any authorId not yet in authors collection
    const authorIds = [...new Set(books.map(b => b.authorId).filter(id => id && !isBlankOrError(id)))];
    let stubsCreated = 0;
    for (const authorId of authorIds) {
      const exists = await db.collection('authors').findOne({ uid: authorId });
      if (!exists) {
        await db.collection('authors').insertOne({
          uid: authorId,
          _stub: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        stubsCreated++;
      }
    }

    const result = await importRecords('books', 'books_backups', books, 'id', SPECIAL_FIELDS_BOOKS);
    res.json({ success: true, ...result, stubAuthorsCreated: stubsCreated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rollup fields are computed from books — never stored on author documents
const ROLLUP_AUTHOR_FIELDS = new Set(['booksCreated','booksChp1Published','books10kCompleted','booksModPassed','booksExpressContracted','booksWBPContracted','booksOFW']);

// ============ AUTHORS ============
app.get('/api/authors', authMiddleware, async (req, res) => {
  try {
    const { search, page = 1, limit = 100 } = req.query;
    const matchQuery = { uid: { $exists: true, $ne: '' } };
    if (search) matchQuery.$or = [
      { name: { $regex: search, $options: 'i' } },
      { uid: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await db.collection('authors').countDocuments(matchQuery);

    const TRUTHY_VALS = [true, 1, 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes', 'y', 'Y', '1'];
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
        booksOFW:               { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpSubStatus',    ''] } }, regex: 'open.?for.?withdrawal|\\bofw\\b' } } } } }
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

app.delete('/api/authors/all', authMiddleware, async (req, res) => {
  try {
    const result = await db.collection('authors').deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/authors/:id', authMiddleware, async (req, res) => {
  try {
    const author = await db.collection('authors').findOne({ uid: req.params.id });
    if (!author) return res.status(404).json({ error: 'Author not found' });
    res.json(author);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/authors/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await db.collection('authors').findOne({ uid: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Author not found' });
    const updates = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (key === '_id' || key === 'uid') continue;
      if (!isBlankOrError(val)) updates[key] = val;
    }
    if (Object.keys(updates).length === 0) return res.json({ success: true, message: 'Nothing to update' });
    await db.collection('authors_backups').insertOne({ ...existing, importId: 'direct-edit', backedUpAt: new Date() });
    await db.collection('authors').updateOne({ uid: req.params.id }, { $set: { ...updates, updatedAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/authors/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.collection('authors').deleteOne({ uid: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Author not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ BOOKS ============
app.get('/api/books', authMiddleware, async (req, res) => {
  try {
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
    const data = await db.collection('books').find(query).skip(skip).limit(parseInt(limit)).toArray();
    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) || 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/books/all', authMiddleware, async (req, res) => {
  try {
    const result = await db.collection('books').deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/books/:id', authMiddleware, async (req, res) => {
  try {
    const book = await db.collection('books').findOne({ id: req.params.id });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/books/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await db.collection('books').findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Book not found' });
    const updates = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (key === '_id' || key === 'id') continue;
      if (!isBlankOrError(val)) updates[key] = val;
    }
    if (Object.keys(updates).length === 0) return res.json({ success: true, message: 'Nothing to update' });
    await db.collection('books_backups').insertOne({ ...existing, importId: 'direct-edit', backedUpAt: new Date() });
    await db.collection('books').updateOne({ id: req.params.id }, { $set: { ...updates, updatedAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/books/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.collection('books').deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Book not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ BACKUPS (Settings) ============
app.get('/api/backups', authMiddleware, async (req, res) => {
  try {
    const authorBackups = await db.collection('authors_backups')
      .aggregate([{ $group: { _id: '$importId', count: { $sum: 1 }, backedUpAt: { $max: '$backedUpAt' } } }])
      .toArray();
    const bookBackups = await db.collection('books_backups')
      .aggregate([{ $group: { _id: '$importId', count: { $sum: 1 }, backedUpAt: { $max: '$backedUpAt' } } }])
      .toArray();
    res.json({
      authors: authorBackups.map(b => ({ importId: b._id, count: b.count, backedUpAt: b.backedUpAt, entity: 'authors' })),
      books: bookBackups.map(b => ({ importId: b._id, count: b.count, backedUpAt: b.backedUpAt, entity: 'books' }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backups/restore', authMiddleware, async (req, res) => {
  try {
    const { importId, entity } = req.body;
    if (!importId || !entity) return res.status(400).json({ error: 'importId and entity required' });
    const backupCol = entity === 'authors' ? 'authors_backups' : 'books_backups';
    const liveCol = entity === 'authors' ? 'authors' : 'books';
    const idField = entity === 'authors' ? 'uid' : 'id';
    const records = await db.collection(backupCol).find({ importId }).toArray();
    if (records.length === 0) return res.status(404).json({ error: 'Backup not found or expired' });
    let restored = 0;
    for (const rec of records) {
      const { _id, _originalId, importId: _imp, backedUpAt, ...data } = rec;
      await db.collection(liveCol).replaceOne({ [idField]: data[idField] }, data, { upsert: true });
      restored++;
    }
    res.json({ success: true, restored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ STATS ============
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const totalAuthors = await db.collection('authors').countDocuments();
    const totalBooks = await db.collection('books').countDocuments();
    res.json({ totalAuthors, totalBooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
