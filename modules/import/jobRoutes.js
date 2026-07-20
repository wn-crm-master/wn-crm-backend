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

      const result = await processEntity(db, entity, records);
      res.json({ status: 'done', ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

async function processEntity(db, entity, records) {
  if (entity === 'authors') return processAuthors(db, records);
  if (entity === 'books') return processBooks(db, records);
  if (entity === 'aes') return processAes(db, records);
  if (entity === 'ae_authors') {
    const seen = new Set();
    const mappings = records.map(r => ({ aeEmail: (r.aeEmail || '').trim().toLowerCase(), uid: (r.uid || '').trim() })).filter(r => {
      if (!r.aeEmail || !r.uid) return false;
      const key = r.aeEmail + '|' + r.uid;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const result = await processAeAuthorMappings(db, mappings);
    await syncNewAeEmails(db, mappings.map(m => ({ aeEmail: m.aeEmail })));
    return result;
  }
  if (entity === 'ae_books') {
    const mappings = records.map(r => ({ aeEmail: (r.aeEmail || '').trim().toLowerCase(), authorId: r.authorId, bookId: r.bookId })).filter(r => r.aeEmail && r.bookId);
    const result = await processAeBookMappings(db, mappings);
    await syncNewAeEmails(db, mappings.map(m => ({ aeEmail: m.aeEmail })));
    return result;
  }
  if (entity === 'ae_payments') return processSimple(db, 'ae_payments', records);
  return { inserted: 0, updated: 0, skipped: 0, processed: 0 };
}

async function processAuthors(db, records) {
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
  const result = await importRecords(db, 'authors', 'authors_backups', cleaned, 'uid', AUTHOR_SPECIAL);
  return { inserted: result.inserted, updated: result.updated, skipped: result.skipped, processed: records.length };
}

async function processBooks(db, records) {
  const authorIds = [...new Set(records.map(b => b.authorId).filter(id => id && !isBlankOrError(id)))];
  let stubs = 0;
  if (authorIds.length) {
    const existingAuthors = await db.collection('authors').find({ uid: { $in: authorIds } }, { projection: { uid: 1 } }).toArray();
    const existingSet = new Set(existingAuthors.map(a => a.uid));
    const stubDocs = authorIds.filter(id => !existingSet.has(id)).map(uid => ({ uid, _stub: true, createdAt: new Date(), updatedAt: new Date() }));
    if (stubDocs.length) {
      await db.collection('authors').insertMany(stubDocs, { ordered: false });
      stubs = stubDocs.length;
    }
  }
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
  const result = await importRecords(db, 'books', 'books_backups', records, 'id', BOOK_SPECIAL);
  return { inserted: result.inserted, updated: result.updated, skipped: result.skipped, processed: records.length, stubs };
}

async function processAes(db, records) {
  const today = new Date().toISOString().slice(0, 10);
  const valid = [];
  let skipped = 0;
  for (const record of records) {
    const email = (record.email || '').trim().toLowerCase();
    if (!email || isBlankOrError(email)) { skipped++; continue; }
    valid.push({ email, name: record.name || '', uid: record.uid || '' });
  }
  if (!valid.length) return { inserted: 0, updated: 0, skipped, processed: records.length };

  const allEmails = valid.map(v => v.email);
  const existingDocs = await db.collection('aes').find({ email: { $in: allEmails } }).toArray();
  const existingSet = new Set(existingDocs.map(d => d.email));

  const newDocs = valid.filter(v => !existingSet.has(v.email)).map(v => ({ ...v, dateAdded: today, createdAt: new Date(), updatedAt: new Date() }));
  if (newDocs.length) await db.collection('aes').insertMany(newDocs, { ordered: false });

  const updateOps = valid.filter(v => existingSet.has(v.email) && ((v.name && !isBlankOrError(v.name)) || (v.uid && !isBlankOrError(v.uid))))
    .map(v => {
      const set = { updatedAt: new Date() };
      if (v.name && !isBlankOrError(v.name)) set.name = v.name;
      if (v.uid && !isBlankOrError(v.uid)) set.uid = v.uid;
      return { updateOne: { filter: { email: v.email }, update: { $set: set } } };
    });
  if (updateOps.length) await db.collection('aes').bulkWrite(updateOps, { ordered: false });

  return { inserted: newDocs.length, updated: valid.filter(v => existingSet.has(v.email)).length, skipped, processed: records.length };
}

async function processAeAuthorMappings(db, records) {
  if (!records.length) return { inserted: 0, updated: 0, skipped: 0, processed: 0 };
  const existingDocs = await db.collection('ae_authors').find({ $or: records.map(r => ({ aeEmail: r.aeEmail, uid: r.uid })) }).toArray();
  const existingKeys = new Set(existingDocs.map(d => d.aeEmail + '|' + d.uid));
  const newRecords = records.filter(r => !existingKeys.has(r.aeEmail + '|' + r.uid));
  if (newRecords.length) {
    newRecords.forEach(r => r.createdAt = new Date());
    await db.collection('ae_authors').insertMany(newRecords, { ordered: false });
  }
  return { inserted: newRecords.length, updated: 0, skipped: records.length - newRecords.length, processed: records.length };
}

async function processAeBookMappings(db, records) {
  if (!records.length) return { inserted: 0, updated: 0, skipped: 0, processed: 0 };
  const existingDocs = await db.collection('ae_books').find({ $or: records.map(r => ({ aeEmail: r.aeEmail, bookId: r.bookId })) }).toArray();
  const existingKeys = new Set(existingDocs.map(d => d.aeEmail + '|' + d.bookId));
  const newRecords = records.filter(r => !existingKeys.has(r.aeEmail + '|' + r.bookId));
  if (newRecords.length) {
    newRecords.forEach(r => r.createdAt = new Date());
    await db.collection('ae_books').insertMany(newRecords, { ordered: false });
  }
  return { inserted: newRecords.length, updated: 0, skipped: records.length - newRecords.length, processed: records.length };
}

async function processSimple(db, collection, records) {
  if (!records.length) return { inserted: 0, updated: 0, skipped: 0, processed: 0 };
  records.forEach(r => r.createdAt = new Date());
  try {
    const result = await db.collection(collection).insertMany(records, { ordered: false });
    return { inserted: result.insertedCount, updated: 0, skipped: 0, processed: records.length };
  } catch (err) {
    const inserted = err.insertedCount || 0;
    return { inserted, updated: 0, skipped: records.length - inserted, processed: records.length };
  }
}

async function syncNewAeEmails(db, records) {
  const today = new Date().toISOString().slice(0, 10);
  const emails = [...new Set(records.map(r => (r.aeEmail || '').trim().toLowerCase()).filter(e => e && !isBlankOrError(e)))];
  const existingDocs = await db.collection('aes').find({ email: { $in: emails } }, { projection: { email: 1 } }).toArray();
  const existingSet = new Set(existingDocs.map(d => d.email));
  const newDocs = emails.filter(e => !existingSet.has(e)).map(email => ({ email, dateAdded: today, createdAt: new Date(), updatedAt: new Date() }));
  if (newDocs.length) await db.collection('aes').insertMany(newDocs, { ordered: false }).catch(() => {});
}

module.exports = { register };
