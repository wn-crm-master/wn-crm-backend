const TRUTHY_VALS = [true, 1, 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes', 'y', 'Y', '1'];

let syncing = false;

async function syncRollups(db) {
  if (syncing) return;
  syncing = true;
  try {
    // ── Author rollups ──────────────────────────────────────────────
    const pipeline = [
      { $lookup: { from: 'books', localField: 'uid', foreignField: 'authorId', as: '_books' } },
      { $addFields: {
        booksCreated:           { $size: '$_books' },
        booksChp1Published:     { $size: { $filter: { input: '$_books', cond: { $in: ['$$this.chp1Published', TRUTHY_VALS] } } } },
        books10kCompleted:      { $size: { $filter: { input: '$_books', cond: { $in: ['$$this.words10kCompleted', TRUTHY_VALS] } } } },
        booksModPassed:         { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.moderationStatus',''] } }, regex: 'pass' } } } } },
        booksExpressContracted: { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpStatus',''] } }, regex: 'express' } } } } },
        booksWBPContracted:     { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpStatus',''] } }, regex: 'wbp' } } } } },
        booksOFW:               { $size: { $filter: { input: '$_books', cond: { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpSubStatus',''] } }, regex: 'open.?for.?withdrawal|\\bofw\\b' } } } } },
        _firstContract: { $reduce: {
          input: { $filter: { input: '$_books', cond: { $and: [
            { $ne: ['$$this.contractSigningDate', null] },
            { $ne: ['$$this.contractSigningDate', ''] }
          ] } } },
          initialValue: null,
          in: { $cond: [
            { $or: [{ $eq: ['$$value', null] }, { $lt: ['$$this.contractSigningDate', '$$value.d'] }] },
            { d: '$$this.contractSigningDate', id: '$$this.id' },
            '$$value'
          ] }
        } },
        _first300k: { $reduce: {
          input: { $filter: { input: '$_books', cond: { $and: [
            { $ne: ['$$this.contractSigningDate', null] },
            { $ne: ['$$this.contractSigningDate', ''] },
            { $ne: ['$$this.words300kDate', null] },
            { $ne: ['$$this.words300kDate', ''] },
            { $or: [
              { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpStatus', ''] } }, regex: 'ongoing' } },
              { $and: [
                { $regexMatch: { input: { $toLower: { $ifNull: ['$$this.wbpStatus', ''] } }, regex: 'rejected' } },
                { $gt: [{ $ifNull: ['$$this.wbpRejectedDate', ''] }, '$$this.words300kDate'] }
              ] }
            ] }
          ] } } },
          initialValue: null,
          in: { $cond: [
            { $or: [{ $eq: ['$$value', null] }, { $lt: ['$$this.words300kDate', '$$value.d'] }] },
            { d: '$$this.words300kDate', id: '$$this.id' },
            '$$value'
          ] }
        } }
      }},
      { $addFields: {
        firstContractDate:   { $ifNull: ['$_firstContract.d', null] },
        firstContractBookId: { $ifNull: ['$_firstContract.id', ''] },
        first300kWordDate:   { $ifNull: ['$_first300k.d', null] },
        first300kWordBookId: { $ifNull: ['$_first300k.id', ''] }
      }},
      { $project: {
        uid: 1,
        booksCreated: 1, booksChp1Published: 1, books10kCompleted: 1,
        booksModPassed: 1, booksExpressContracted: 1, booksWBPContracted: 1, booksOFW: 1,
        firstContractDate: 1, firstContractBookId: 1,
        first300kWordDate: 1, first300kWordBookId: 1
      }}
    ];

    const results = await db.collection('authors').aggregate(pipeline, { allowDiskUse: true }).toArray();

    const bulk = db.collection('authors').initializeUnorderedBulkOp();
    for (const r of results) {
      bulk.find({ uid: r.uid }).updateOne({ $set: {
        booksCreated: r.booksCreated,
        booksChp1Published: r.booksChp1Published,
        books10kCompleted: r.books10kCompleted,
        booksModPassed: r.booksModPassed,
        booksExpressContracted: r.booksExpressContracted,
        booksWBPContracted: r.booksWBPContracted,
        booksOFW: r.booksOFW,
        firstContractDate: r.firstContractDate,
        firstContractBookId: r.firstContractBookId,
        first300kWordDate: r.first300kWordDate,
        first300kWordBookId: r.first300kWordBookId,
        _rollupsUpdatedAt: new Date()
      }});
    }
    if (results.length) await bulk.execute();
    console.log(`Rollup sync complete: ${results.length} authors updated`);

    // ── AE rollups & denormalized book author fields ─────────────────
    await Promise.all([
      syncAeRollups(db, results),
      syncBookAuthorFields(db)
    ]);
  } catch (err) {
    console.error('Rollup sync error:', err);
  } finally {
    syncing = false;
  }
}

// Denormalize author fields (pre-contract tag/company, AE email) onto book
// documents so book queries/exports never need a $lookup join.
async function syncBookAuthorFields(db) {
  try {
    const authors = await db.collection('authors').find({}, {
      projection: { uid: 1, preContractedTag: 1, preContractCompany: 1, aeEmail: 1 }
    }).toArray();
    const authorMap = {};
    for (const a of authors) authorMap[a.uid] = a;

    const books = await db.collection('books').find(
      { authorId: { $exists: true, $ne: '' } },
      { projection: { id: 1, authorId: 1 } }
    ).toArray();
    if (!books.length) return;

    const bulk = db.collection('books').initializeUnorderedBulkOp();
    for (const b of books) {
      const a = authorMap[b.authorId] || {};
      bulk.find({ id: b.id }).updateOne({ $set: {
        authorPreContract: a.preContractedTag || '',
        authorPreContractCompany: a.preContractCompany || '',
        authorAeEmail: a.aeEmail || ''
      }});
    }
    await bulk.execute();
    console.log(`Book author-field sync complete: ${books.length} books updated`);
  } catch (err) {
    console.error('Book author-field sync error:', err);
  }
}

async function syncAeRollups(db, authorResults) {
  try {
    const now = new Date();
    const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

    const authorMap = {};
    for (const a of authorResults) authorMap[a.uid] = a;

    const allAuthors = await db.collection('authors').find({}, {
      projection: { uid: 1, aeEmail: 1, regnDate: 1, preContractedTag: 1, firstContractDate: 1, first300kWordDate: 1 }
    }).toArray();
    for (const a of allAuthors) {
      if (!authorMap[a.uid]) authorMap[a.uid] = a;
      else Object.assign(authorMap[a.uid], { aeEmail: a.aeEmail, regnDate: a.regnDate, preContractedTag: a.preContractedTag });
    }

    const aeAuthors = await db.collection('ae_authors').find({}).toArray();
    const books = await db.collection('books').find({}, {
      projection: { id: 1, authorId: 1, status: 1 }
    }).toArray();

    const aePayments = await db.collection('ae_payments').find({}, {
      projection: { aeEmail: 1, rewardDate: 1 }
    }).toArray();

    const mappingsByAe = {};
    for (const m of aeAuthors) {
      const email = (m.aeEmail || '').trim().toLowerCase();
      if (!email) continue;
      if (!mappingsByAe[email]) mappingsByAe[email] = [];
      mappingsByAe[email].push(m.uid);
    }

    const booksByAuthor = {};
    for (const b of books) {
      if (!b.authorId) continue;
      if (!booksByAuthor[b.authorId]) booksByAuthor[b.authorId] = [];
      booksByAuthor[b.authorId].push(b);
    }

    const paymentsByAe = {};
    for (const p of aePayments) {
      const email = (p.aeEmail || '').trim().toLowerCase();
      if (!email) continue;
      if (!paymentsByAe[email]) paymentsByAe[email] = [];
      paymentsByAe[email].push(p);
    }

    function isLastMonth(dateStr) {
      if (!dateStr) return false;
      const d = String(dateStr).slice(0, 10);
      return d >= lmStart && d <= lmEnd;
    }

    const aes = await db.collection('aes').find({}).toArray();
    if (!aes.length) return;

    const aeBulk = db.collection('aes').initializeUnorderedBulkOp();
    for (const ae of aes) {
      const email = (ae.email || '').toLowerCase();
      const uids = mappingsByAe[email] || [];

      const authorsReg = uids.length;
      const preContractAuthorsReg = uids.filter(uid => {
        const a = authorMap[uid];
        return a && a.preContractedTag && String(a.preContractedTag).toLowerCase() !== 'no' && String(a.preContractedTag).trim() !== '';
      }).length;

      let booksCreated = 0, activeBooks = 0, activeBooksUncont = 0;
      const uncontUids = new Set(uids.filter(uid => {
        const d = authorMap[uid]?.firstContractDate;
        return !d || String(d).trim() === '';
      }));
      for (const uid of uids) {
        const uidBooks = booksByAuthor[uid] || [];
        booksCreated += uidBooks.length;
        for (const b of uidBooks) {
          const s = (b.status || '').toLowerCase();
          if (s === 'approved' || s === 'published') {
            activeBooks++;
            if (uncontUids.has(uid)) activeBooksUncont++;
          }
        }
      }

      const totalAuthCont = uids.filter(uid => {
        const d = authorMap[uid]?.firstContractDate;
        return d && String(d).trim() !== '';
      }).length;

      const authContBeforeLM = uids.filter(uid => {
        const d = authorMap[uid]?.firstContractDate;
        return d && String(d).slice(0, 10) < lmStart;
      }).length;

      const stage1Cleared = uids.filter(uid => isLastMonth(authorMap[uid]?.firstContractDate)).length;
      const stage2Cleared = uids.filter(uid => isLastMonth(authorMap[uid]?.first300kWordDate)).length;
      const stage3Cleared = Math.floor((authContBeforeLM + stage1Cleared) / 10) - Math.floor(authContBeforeLM / 10);
      const lmEarnings = stage1Cleared * 50 + stage2Cleared * 200 + stage3Cleared * 100;

      const regDates = uids.map(uid => authorMap[uid]?.regnDate).filter(d => d).sort();
      const firstAuthorRegDate = regDates.length ? regDates[0] : '';
      const latestAuthorRegDate = regDates.length ? regDates[regDates.length - 1] : '';

      const myPayments = paymentsByAe[email] || [];
      const rewardDates = myPayments.map(p => p.rewardDate).filter(d => d).sort();
      const latestRewardDate = rewardDates.length ? rewardDates[rewardDates.length - 1] : '';

      const aeStatus = activeBooks > 0 ? 'active' : 'inactive';

      aeBulk.find({ email }).updateOne({ $set: {
        authorsReg, preContractAuthorsReg, booksCreated, activeBooks, activeBooksUncont,
        totalAuthCont, authContBeforeLM,
        lmStage1Cleared: stage1Cleared, lmStage2Cleared: stage2Cleared, lmStage3Cleared: stage3Cleared,
        lmEarnings,
        firstAuthorRegDate, latestAuthorRegDate, latestRewardDate,
        aeStatus, _rollupsUpdatedAt: new Date()
      }});
    }
    await aeBulk.execute();
    console.log(`AE rollup sync complete: ${aes.length} AEs updated`);
  } catch (err) {
    console.error('AE rollup sync error:', err);
  }
}

function triggerSync(db) {
  setImmediate(() => syncRollups(db));
}

module.exports = { syncRollups, triggerSync };
