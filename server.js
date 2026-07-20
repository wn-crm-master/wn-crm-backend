require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const compression = require('compression');
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
const { register: registerEarningsRoutes } = require('./modules/earnings/routes');
const { register: registerReportsRoutes } = require('./modules/reports/routes');
const { register: registerLlmSheet } = require('./modules/llmSheet');
const { register: registerAeSubRoutes } = require('./modules/aes/subRoutes');
const { register: registerEmails } = require('./modules/emails/routes');
const { syncRollups } = require('./modules/rollupSync');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('FATAL: MONGO_URI is not set in environment'); process.exit(1); }
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
    db.collection('books').createIndex({ authorId: 1 }).catch(() => {});
    db.collection('books').createIndex({ stage: 1 }).catch(() => {});
    db.collection('books').createIndex({ stageImp: 1 }).catch(() => {});
    db.collection('books').createIndex({ stageUrg: 1 }).catch(() => {});
    db.collection('books').createIndex({ createMonth: 1 }).catch(() => {});
    db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(() => {});
    db.collection('authors_backups').createIndex({ backedUpAt: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
    db.collection('books_backups').createIndex({ backedUpAt: 1 }, { expireAfterSeconds: 86400 }).catch(() => {});
    db.collection('authors').createIndex({ aeEmail: 1 }, { sparse: true }).catch(() => {});
    db.collection('aes').createIndex({ email: 1 }, { unique: true }).catch(() => {});
    db.collection('ae_authors').createIndex({ aeEmail: 1, uid: 1 }, { unique: true }).catch(() => {});
    db.collection('ae_books').createIndex({ aeEmail: 1 }).catch(() => {});
    db.collection('ae_payments').createIndex({ aeEmail: 1 }).catch(() => {});
    db.collection('email_campaigns').createIndex({ createdAt: -1 }).catch(() => {});
    db.collection('email_sends').createIndex({ campaignId: 1 }).catch(() => {});
    db.collection('email_sends').createIndex({ resendId: 1 }, { sparse: true }).catch(() => {});
    seedUsers(db).catch(err => console.error('User seed error:', err));
    // One-time migration: boolean true → "YES" for form1 fields
    (async () => {
      const form1Fields = ['form1MailSent','form1FollowUp1Sent','form1FollowUp2Sent','form1Filled'];
      for (const f of form1Fields) {
        await db.collection('authors').updateMany({ [f]: true }, { $set: { [f]: 'YES' } }).catch(() => {});
        await db.collection('authors').updateMany({ [f]: false }, { $set: { [f]: '' } }).catch(() => {});
      }
    })().catch(err => console.error('form1 migration error:', err));
    startScheduledSync(getDb);
    // Run rollup sync 15s after boot so stage/createMonth are always populated
    setTimeout(() => syncRollups(db).catch(err => console.error('Startup rollup error:', err)), 15000);
    // Hourly rollup sync as a safety net for any missed triggerSync calls
    setInterval(() => { if (db) syncRollups(db); }, 60 * 60 * 1000);
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

const authMiddleware = (req, res, next) => next();

// DB availability guard — applied after /api/health so health check still works when DB is down
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (!db) return res.status(503).json({ error: 'Database not available' });
  next();
});

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: db ? 'connected' : 'disconnected' });
});

// Manual resync — fire-and-forget so Render's 30s timeout doesn't kill it
app.post('/api/resync', authMiddleware, (req, res) => {
  res.json({ success: true, message: 'Sync started in background' });
  setImmediate(() => syncRollups(getDb()).catch(err => console.error('Manual resync error:', err)));
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
registerEarningsRoutes(app, getDb, authMiddleware);
registerReportsRoutes(app, getDb, authMiddleware);
registerLlmSheet(app, getDb, authMiddleware);
registerEmails(app, getDb, authMiddleware);

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
