const TRUTHY_VALS = [true, 1, 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes', 'y', 'Y', '1'];

let syncing = false;

async function syncRollups(db) {
  if (syncing) return;
  syncing = true;
  try {
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
  } catch (err) {
    console.error('Rollup sync error:', err);
  } finally {
    syncing = false;
  }
}

function triggerSync(db) {
  setImmediate(() => syncRollups(db));
}

module.exports = { syncRollups, triggerSync };
