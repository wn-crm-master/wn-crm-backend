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
    await processSimple(db, 'ae_authors', records, job);
  } else if (entity === 'ae_books') {
    await processSimple(db, 'ae_books', records, job);
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

  for (const record of cleaned) {
    try {
      const result = await importRecords(db, 'authors', 'authors_backups', [record], 'uid', AUTHOR_SPECIAL);
      job.inserted += result.inserted;
      job.updated += result.updated;
      job.skipped += result.skipped;
    } catch {
      job.skipped++;
    }
    job.processed++;
  }
}

async function processBooks(db, records, job) {
  const authorIds = [...new Set(records.map(b => b.authorId).filter(id => id && !isBlankOrError(id)))];
  let stubsCreated = 0;
  for (const authorId of authorIds) {
    const exists = await db.collection('authors').findOne({ uid: authorId });
    if (!exists) {
      await db.collection('authors').insertOne({ uid: authorId, _stub: true, createdAt: new Date(), updatedAt: new Date() });
      stubsCreated++;
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

  for (const record of records) {
    try {
      const result = await importRecords(db, 'books', 'books_backups', [record], 'id', BOOK_SPECIAL);
      job.inserted += result.inserted;
      job.updated += result.updated;
      job.skipped += result.skipped;
    } catch {
      job.skipped++;
    }
    job.processed++;
  }
}

async function processAes(db, records, job) {
  const today = new Date().toISOString().slice(0, 10);

  for (const record of records) {
    const email = (record.email || '').trim().toLowerCase();
    if (!email || isBlankOrError(email)) {
      job.skipped++;
      job.processed++;
      continue;
    }
    record.email = email;

    try {
      const existing = await db.collection('aes').findOne({ email });
      if (!existing) {
        record.dateAdded = today;
        record.createdAt = new Date();
        record.updatedAt = new Date();
        await db.collection('aes').insertOne(record);
        job.inserted++;
      } else {
        const updateFields = {};
        for (const [key, val] of Object.entries(record)) {
          if (key === '_id' || key === 'dateAdded') continue;
          if (isBlankOrError(val)) continue;
          updateFields[key] = val;
        }
        if (Object.keys(updateFields).length > 0) {
          updateFields.updatedAt = new Date();
          await db.collection('aes').updateOne({ email }, { $set: updateFields });
        }
        job.updated++;
      }
    } catch {
      job.skipped++;
    }
    job.processed++;
  }
}

async function processSimple(db, collection, records, job) {
  for (const record of records) {
    try {
      record.createdAt = new Date();
      await db.collection(collection).insertOne(record);
      job.inserted++;
    } catch {
      job.skipped++;
    }
    job.processed++;
  }
}

module.exports = { register };
