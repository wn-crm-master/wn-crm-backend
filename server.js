require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'wn-crm-secret-change-in-production';

let db;
let authorsCollection;
let usersCollection;

// Connect to MongoDB
MongoClient.connect(MONGO_URI)
  .then(client => {
    console.log('✓ Connected to MongoDB Atlas');
    db = client.db('wn-crm');
    authorsCollection = db.collection('authors');
    usersCollection = db.collection('users');
    
    // Create indexes
    authorsCollection.createIndex({ penName: 1 });
    authorsCollection.createIndex({ views: -1 });
    authorsCollection.createIndex({ overallStatus: 1 });
    usersCollection.createIndex({ email: 1 }, { unique: true });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ============ AUTH ROUTES ============

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    // Check if user exists
    const existing = await usersCollection.findOne({ email });
    if (existing) return res.status(400).json({ error: 'User already exists' });
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const result = await usersCollection.insertOne({
      email,
      password: hashedPassword,
      name,
      createdAt: new Date()
    });
    
    const token = jwt.sign({ userId: result.insertedId }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({ token, user: { id: result.insertedId, email, name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ AUTHORS ROUTES ============

// Get all authors
app.get('/api/authors', authMiddleware, async (req, res) => {
  try {
    const authors = await authorsCollection.find({}).toArray();
    res.json(authors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update multiple authors (bulk upsert)
app.post('/api/authors/bulk', authMiddleware, async (req, res) => {
  try {
    const { authors } = req.body;
    
    if (!Array.isArray(authors) || authors.length === 0) {
      return res.status(400).json({ error: 'Authors array required' });
    }
    
    // Bulk operations
    const operations = authors.map(author => ({
      updateOne: {
        filter: { id: author.id },
        update: { $set: { ...author, updatedAt: new Date() } },
        upsert: true
      }
    }));
    
    const result = await authorsCollection.bulkWrite(operations);
    
    res.json({
      success: true,
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
      total: authors.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update single author
app.put('/api/authors/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const result = await authorsCollection.updateOne(
      { id },
      { $set: { ...updates, updatedAt: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Author not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete author
app.delete('/api/authors/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await authorsCollection.deleteOne({ id });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Author not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: db ? 'connected' : 'disconnected' });
});

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
