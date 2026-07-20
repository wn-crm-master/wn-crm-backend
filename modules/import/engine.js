const crypto = require('crypto');

const REJECT_VALUES = new Set(['', 'null', 'undefined', 'n/a', '#error', '#ref!']);

function isBlankOrError(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  return s === '' || REJECT_VALUES.has(s.toLowerCase());
}

async function importRecords(db, collection, backupCollection, records, idField, specialFields) {
  const importId = crypto.randomBytes(6).toString('hex');
  let inserted = 0, updated = 0, skipped = 0;
  const skippedReasons = [];
  const specialFieldChanges = [];

  const validRecords = [];
  for (const record of records) {
    const uid = record[idField];
    if (!uid || isBlankOrError(uid)) {
      skipped++;
      skippedReasons.push({ id: null, reason: 'Missing unique ID' });
    } else {
      validRecords.push(record);
    }
  }

  if (!validRecords.length) {
    return { importId, inserted, updated, skipped, skippedReasons, specialFieldChanges };
  }

  const allIds = validRecords.map(r => r[idField]);
  const existingDocs = await db.collection(collection).find({ [idField]: { $in: allIds } }).toArray();
  const existingMap = new Map();
  for (const doc of existingDocs) existingMap.set(doc[idField], doc);

  // Backups skipped during bulk import — only kept for single-record edits

  const ops = [];
  for (const record of validRecords) {
    const uid = record[idField];
    const existing = existingMap.get(uid);

    if (!existing) {
      ops.push({ insertOne: { document: { ...record, createdAt: new Date(), updatedAt: new Date() } } });
      inserted++;
    } else {
      const updateFields = {};
      let allBlank = true;

      for (const [key, newVal] of Object.entries(record)) {
        if (key === '_id') continue;
        if (isBlankOrError(newVal)) continue;
        allBlank = false;

        if (specialFields.includes(key) && existing[key] !== undefined && existing[key] !== newVal) {
          specialFieldChanges.push({
            importId, entityId: uid, field: key,
            oldValue: existing[key], newValue: newVal, status: 'pending_approval'
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
        ops.push({ updateOne: { filter: { [idField]: uid }, update: { $set: updateFields } } });
      }
      updated++;
    }
  }

  if (ops.length) await db.collection(collection).bulkWrite(ops, { ordered: false });

  if (specialFieldChanges.length > 0) {
    await db.collection('pending_approvals').insertMany(specialFieldChanges);
  }

  return { importId, inserted, updated, skipped, skippedReasons, specialFieldChanges };
}

module.exports = { isBlankOrError, importRecords, REJECT_VALUES };
