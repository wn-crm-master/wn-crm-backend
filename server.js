require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const { createAuthMiddleware, seedUsers, register: registerAuth } = require('./modules/auth');
const { register: registerAuthorRoutes } = require('./modules/authors/routes');
const { register: registerAuthorImport } = require('./modules/authors/import');
const { register: registerBookRoutes } = require('./modules/books/routes');
const { register: registerBookImport } = require('./modules/books/import');
const { register: registerBackups } = require('./modules/backups');
const { register: registerStats } = require('./modules/stats');
const { register: registerSheetSync, startScheduledSync } = require('./modules/sheetSync');
const { register: registerImportJobs } = require('./modules/import/jobRoutes');
const { register: registerAeRoutes } = require('./modules/aes/routes');
const { register: registerAeImport } = require('./modules/aes/import');
const { register: registerAeSubRoutes } = require('./modules/aes/subRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'wn-crm-secret-change-in-production';

let db;
const getDb = () => db;

MongoClient.connect(MONGO_URI)
  .then(client => {
    console.log('Connected to MongoDB Atlas');
    db = client.db('author-books-db');
    db.collection('authors').createIndex({ uid: 1 }, { unique: true, sparse: true }).catch(() => {});
    db.collection('authors').dropIndex('id_1').catch(() => {});
    db.collection('books').createIndex({ id: 1 }, { unique: true }).catch(() => {});
    db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(() => {});
    db.collection('authors_backups').createIndex({ backedUpAt: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
    db.collection('books_backups').createIndex({ backedUpAt: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
    db.collection('aes').createIndex({ email: 1 }, { unique: true }).catch(() => {});
    db.collection('ae_authors').createIndex({ aeEmail: 1, uid: 1 }).catch(() => {});
    db.collection('ae_books').createIndex({ aeEmail: 1 }).catch(() => {});
    db.collection('ae_payments').createIndex({ aeEmail: 1 }).catch(() => {});
    seedUsers(db).catch(err => console.error('User seed error:', err));
    startScheduledSync(getDb);
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const authMiddleware = createAuthMiddleware(JWT_SECRET);

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: db ? 'connected' : 'disconnected' });
});

// Register all modules
registerAuth(app, getDb, JWT_SECRET);
registerAuthorImport(app, getDb, authMiddleware);
registerAuthorRoutes(app, getDb, authMiddleware);
registerBookImport(app, getDb, authMiddleware);
registerBookRoutes(app, getDb, authMiddleware);
registerBackups(app, getDb, authMiddleware);
registerStats(app, getDb, authMiddleware);
registerSheetSync(app, getDb, authMiddleware);
registerImportJobs(app, getDb, authMiddleware);
registerAeImport(app, getDb, authMiddleware);
registerAeRoutes(app, getDb, authMiddleware);
registerAeSubRoutes(app, getDb, authMiddleware);

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
