require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'wn-crm-secret-change-in-production';

let db;

MongoClient.connect(MONGO_URI)
  .then(client => {
    console.log('Connected to MongoDB Atlas');
    db = client.db('author-books-db');
    db.collection('authors').createIndex({ id: 1 }, { unique: true }).catch(() => {});
    db.collection('books').createIndex({ id: 1 }, { unique: true }).catch(() => {});
    db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(() => {});
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

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: db ? 'connected' : 'disconnected' });
});

// Auth
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

// Import - supports JSON body or file upload
app.post('/api/import', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    let data;
    if (req.file) {
      data = JSON.parse(req.file.buffer.toString('utf8'));
    } else {
      data = req.body;
    }
    const { authors = [], books = [] } = data;

    let authorInserted = 0, authorUpdated = 0;
    let bookInserted = 0, bookUpdated = 0;

    if (authors.length > 0) {
      const ops = authors.map(a => ({
        updateOne: { filter: { id: a.id }, update: { $set: { ...a, updatedAt: new Date() } }, upsert: true }
      }));
      const r = await db.collection('authors').bulkWrite(ops);
      authorInserted = r.upsertedCount;
      authorUpdated = r.modifiedCount;
    }

    if (books.length > 0) {
      const ops = books.map(b => ({
        updateOne: { filter: { id: b.id }, update: { $set: { ...b, updatedAt: new Date() } }, upsert: true }
      }));
      const r = await db.collection('books').bulkWrite(ops);
      bookInserted = r.upsertedCount;
      bookUpdated = r.modifiedCount;
    }

    res.json({
      success: true,
      authors: { inserted: authorInserted, updated: authorUpdated },
      books: { inserted: bookInserted, updated: bookUpdated }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Authors
app.get('/api/authors', authMiddleware, async (req, res) => {
  try {
    const { search, genre, page = 1, limit = 20 } = req.query;
    const query = {};
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { penName: { $regex: search, $options: 'i' } }
    ];
    if (genre) query.genres = { $regex: genre, $options: 'i' };
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await db.collection('authors').countDocuments(query);
    const data = await db.collection('authors').find(query).skip(skip).limit(parseInt(limit)).toArray();
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
    const author = await db.collection('authors').findOne({ id: req.params.id });
    if (!author) return res.status(404).json({ error: 'Author not found' });
    res.json(author);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/authors/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.collection('authors').deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Author not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Books
app.get('/api/books', authMiddleware, async (req, res) => {
  try {
    const { search, genre, authorId, year, page = 1, limit = 20 } = req.query;
    const query = {};
    if (search) query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { authorName: { $regex: search, $options: 'i' } }
    ];
    if (genre) query.genre = { $regex: genre, $options: 'i' };
    if (authorId) query.authorId = authorId;
    if (year) query.publishedYear = parseInt(year);
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await db.collection('books').countDocuments(query);
    const data = await db.collection('books').find(query).skip(skip).limit(parseInt(limit)).toArray();
    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) || 1 });
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

app.delete('/api/books/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.collection('books').deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Book not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const totalAuthors = await db.collection('authors').countDocuments();
    const totalBooks = await db.collection('books').countDocuments();
    const genresFromAuthors = await db.collection('authors').distinct('genres');
    const genresFromBooks = await db.collection('books').distinct('genre');
    const genres = [...new Set([...genresFromAuthors, ...genresFromBooks])].filter(Boolean);
    const ratingAgg = await db.collection('books').aggregate([
      { $group: { _id: null, avg: { $avg: '$rating' } } }
    ]).toArray();
    const avgRating = ratingAgg.length > 0 ? Math.round(ratingAgg[0].avg * 10) / 10 : 0;
    res.json({ totalAuthors, totalBooks, genres, avgRating });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
