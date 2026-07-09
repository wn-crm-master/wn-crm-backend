const { createJob, getJob } = require('./jobs');
const { importRecords, isBlankOrError } = require('./engine');
const { SPECIAL_FIELDS: AUTHOR_SPECIAL, ROLLUP_FIELDS } = require('../authors/fields');
const { SPECIAL_FIELDS: BOOK_SPECIAL } = require('../books/fields');

function register(app, getDb, authMiddleware) {
  app.post('/api/import-job/:entity', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const entity = req.params.entity;
      const { records = [] } = req.body;

      if (!Array.isArray(records) || records.length === 0)
        return res.status(400).json({ error: 'records array is required' });

      if (!['authors', 'books', 'aes', 'ae_authors', 'ae_books', 'ae_payments'].includes(entity))
        return res.status(400).json({ error: 'Invalid entity' });

      const job = createJob(records.length);
      res.json({ jobId: job.id, total: records.length });

      processJob(db, entity, records, job).catch(err => {
        job.status = 'error';
        job.error = err.message;
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/import-job/:jobId', authMiddleware, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
      status: job.status,
      total: job.total,
      processed: job.processed,
      inserted: job.inserted,
      updated: job.updated,
      skipped: job.skipped,
      stubs: job.stubs,
      error: job.error,
    });
  });
}

async function processJob(db, entity, records, job) {
  if (entity === 'authors') {
    await processAuthors(db, records, job);
  } else if (entity === 'books') {
    await processBooks(db, records, job);
  } else if (entity === 'aes') {
    await processAes(db, records, job);
  } else if (entity === 'ae_authors') {
    const seen = new Set();
    const mappings = records.map(r => ({ aeEmail: (r.aeEmail || '').trim().toLowerCase(), uid: (r.uid || '').trim() })).filter(r => {
      if (!r.aeEmail || !r.uid) return false;
      const key = r.aeEmail + '|' + r.uid;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await processAeAuthorMappings(db, mappings, job);
    await syncNewAeEmails(db, mappings.map(m => ({ aeEmail: m.aeEmail })));
  } else if (entity === 'ae_books') {
    const mappings = records.map(r => ({ aeEmail: (r.aeEmail || '').trim().toLowerCase(), authorId: r.authorId, bookId: r.bookId })).filter(r => r.aeEmail && r.bookId);
    await processAeBookMappings(db, mappings, job);
    await syncNewAeEmails(db, mappings.map(m => ({ aeEmail: m.aeEmail })));
  } else if (entity === 'ae_payments') {
    await processSimple(db, 'ae_payments', records, job);
  }
  if (job.status === 'running') job.status = 'done';
}

async function processAuthors(db, records, job) {
  const normalized = records.map(a => {
    if (!a.uid && a.id) { const r = { ...a }; r.uid = r.id; delete r.id; return r; }
    return a;
  });
  const cleaned = normalized.map(a => {
    const r = { ...a };
    ROLLUP_FIELDS.forEach(f => delete r[f]);
    return r;
  });
  cleaned.forEach(a => {
    if (a.incentiveFlag === '0' || a.incentiveFlag === 0) a.incentiveFlag = 'Off';
    if (a.incentiveFlag === '1' || a.incentiveFlag === 1) a.incentiveFlag = 'On';
  });

  try {
    const result = await importRecords(db, 'authors', 'authors_backups', cleaned, 'uid', AUTHOR_SPECIAL);
    job.inserted += result.inserted;
    job.updated += result.updated;
    job.skipped += result.skipped;
  } catch (err) {
    job.skipped += cleaned.length;
  }
  job.processed = records.length;
}

async function processBooks(db, records, job) {
  // Bulk-check existing authors instead of one-by-one
  const authorIds = [...new Set(records.map(b => b.authorId).filter(id => id && !isBlankOrError(id)))];
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
  job.stubs = stubsCreated;

  for (const b of records) {
    if (b.chp1PublishedDate && !isBlankOrError(b.chp1PublishedDate) && !b.chp1Published) b.chp1Published = true;
    if (b.words10kDate && !isBlankOrError(b.words10kDate) && !b.words10kCompleted) b.words10kCompleted = true;
    if (b.words50kDate && !isBlankOrError(b.words50kDate) && !b.words50kCompleted) b.words50kCompleted = true;
    const wc = typeof b.pubWC === 'number' ? b.pubWC : parseInt(String(b.pubWC || '').replace(/,/g, ''), 10);
    if (!isNaN(wc) && wc >= 10000 && !b.words10kCompleted) b.words10kCompleted = true;
    if (!isNaN(wc) && wc >= 50000 && !b.words50kCompleted) b.words50kCompleted = true;
    if (b.incentiveFlag === '0' || b.incentiveFlag === 0) b.incentiveFlag = 'Off';
    if (b.incentiveFlag === '1' || b.incentiveFlag === 1) b.incentiveFlag = 'On';
  }

  try {
    const result = await importRecords(db, 'books', 'books_backups', records, 'id', BOOK_SPECIAL);
    job.inserted += result.inserted;
    job.updated += result.updated;
    job.skipped += result.skipped;
  } catch (err) {
    job.skipped += records.length;
  }
  job.processed = records.length;
}

async function processAes(db, records, job) {
  const today = new Date().toISOString().slice(0, 10);
  const valid = [];
  for (const record of records) {
    const email = (record.email || '').trim().toLowerCase();
    if (!email || isBlankOrError(email)) { job.skipped++; continue; }
    valid.push({ email, name: record.name || '' });
  }
  if (!valid.length) { job.processed = records.length; return; }

  const allEmails = valid.map(v => v.email);
  const existingDocs = await db.collection('aes').find({ email: { $in: allEmails } }).toArray();
  const existingSet = new Set(existingDocs.map(d => d.email));

  const newDocs = valid.filter(v => !existingSet.has(v.email)).map(v => ({ ...v, dateAdded: today, createdAt: new Date(), updatedAt: new Date() }));
  if (newDocs.length) {
    await db.collection('aes').insertMany(newDocs, { ordered: false });
    job.inserted += newDocs.length;
  }

  const updateOps = valid.filter(v => existingSet.has(v.email) && v.name && !isBlankOrError(v.name))
    .map(v => ({ updateOne: { filter: { email: v.email }, update: { $set: { name: v.name, updatedAt: new Date() } } } }));
  if (updateOps.length) await db.collection('aes').bulkWrite(updateOps, { ordered: false });
  job.updated += valid.filter(v => existingSet.has(v.email)).length;
  job.processed = records.length;
}

async function processAeAuthorMappings(db, records, job) {
  if (!records.length) { return; }
  const existingDocs = await db.collection('ae_authors').find({
    $or: records.map(r => ({ aeEmail: r.aeEmail, uid: r.uid }))
  }).toArray();
  const existingKeys = new Set(existingDocs.map(d => d.aeEmail + '|' + d.uid));
  const newRecords = records.filter(r => !existingKeys.has(r.aeEmail + '|' + r.uid));
  job.skipped += records.length - newRecords.length;
  if (newRecords.length) {
    newRecords.forEach(r => r.createdAt = new Date());
    await db.collection('ae_authors').insertMany(newRecords, { ordered: false });
    job.inserted += newRecords.length;
  }
  job.processed = records.length;
}

async function processAeBookMappings(db, records, job) {
  if (!records.length) { return; }
  const existingDocs = await db.collection('ae_books').find({
    $or: records.map(r => ({ aeEmail: r.aeEmail, bookId: r.bookId }))
  }).toArray();
  const existingKeys = new Set(existingDocs.map(d => d.aeEmail + '|' + d.bookId));
  const newRecords = records.filter(r => !existingKeys.has(r.aeEmail + '|' + r.bookId));
  job.skipped += records.length - newRecords.length;
  if (newRecords.length) {
    newRecords.forEach(r => r.createdAt = new Date());
    await db.collection('ae_books').insertMany(newRecords, { ordered: false });
    job.inserted += newRecords.length;
  }
  job.processed = records.length;
}

async function processSimple(db, collection, records, job) {
  if (!records.length) { return; }
  records.forEach(r => r.createdAt = new Date());
  try {
    const result = await db.collection(collection).insertMany(records, { ordered: false });
    job.inserted += result.insertedCount;
  } catch (err) {
    if (err.insertedCount !== undefined) {
      job.inserted += err.insertedCount;
      job.skipped += records.length - err.insertedCount;
    } else {
      job.skipped += records.length;
    }
  }
  job.processed = records.length;
}

async function syncNewAeEmails(db, records) {
  const today = new Date().toISOString().slice(0, 10);
  const emails = [...new Set(
    records.map(r => (r.aeEmail || '').trim().toLowerCase()).filter(e => e && !isBlankOrError(e))
  )];
  for (const email of emails) {
    const exists = await db.collection('aes').findOne({ email });
    if (!exists) {
      await db.collection('aes').insertOne({
        email,
        dateAdded: today,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
}

module.exports = { register };
