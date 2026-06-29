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

  for (const record of records) {
    const uid = record[idField];

    if (!uid || isBlankOrError(uid)) {
      skipped++;
      skippedReasons.push({ id: null, reason: 'Missing unique ID' });
      continue;
    }

    const existing = await db.collection(collection).findOne({ [idField]: uid });

    if (!existing) {
      await db.collection(collection).insertOne({ ...record, createdAt: new Date(), updatedAt: new Date() });
      inserted++;
    } else {
      const { _id, ...existingData } = existing;
      await db.collection(backupCollection).insertOne({
        ...existingData,
        _originalId: _id,
        importId,
        backedUpAt: new Date()
      });

      const updateFields = {};
      let allBlank = true;

      for (const [key, newVal] of Object.entries(record)) {
        if (key === '_id') continue;
        if (isBlankOrError(newVal)) continue;

        allBlank = false;

        if (specialFields.includes(key) && existing[key] !== undefined && existing[key] !== newVal) {
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

  if (specialFieldChanges.length > 0) {
    await db.collection('pending_approvals').insertMany(specialFieldChanges);
  }

  return { importId, inserted, updated, skipped, skippedReasons, specialFieldChanges };
}

module.exports = { isBlankOrError, importRecords, REJECT_VALUES };
