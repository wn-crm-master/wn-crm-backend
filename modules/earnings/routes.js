function register(app, getDb, authMiddleware) {

  app.post('/api/earnings/ae', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { months } = req.body;
      if (!Array.isArray(months) || !months.length) return res.status(400).json({ error: 'months array is required' });

      const monthRanges = months.map(v => {
        const [yStr, mStr] = v.split('-');
        const year = parseInt(yStr), month = parseInt(mStr) - 1;
        const start = new Date(year, month, 1).toISOString().slice(0, 10);
        const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
        const nextStart = new Date(year, month + 1, 1).toISOString().slice(0, 10);
        return { key: v, start, end, nextStart };
      });

      const earliestStart = monthRanges.reduce((min, r) => r.start < min ? r.start : min, monthRanges[0].start);

      const authors = await db.collection('authors').find(
        { uid: { $exists: true, $ne: '' }, aeEmail: { $exists: true, $ne: '' } },
        { projection: { _id: 0, uid: 1, aeEmail: 1, firstContractDate: 1, first300kWordDate: 1 }, batchSize: 10000 }
      ).toArray();

      function isInAnyMonth(dateStr) {
        if (!dateStr) return false;
        const d = String(dateStr).slice(0, 10);
        return monthRanges.some(r => d >= r.start && d <= r.end);
      }

      const aeMap = {};
      for (const a of authors) {
        const ae = (a.aeEmail || '').trim().toLowerCase();
        if (!ae) continue;
        if (!aeMap[ae]) aeMap[ae] = [];
        aeMap[ae].push(a);
      }

      const rows = [];
      for (const [aeEmail, auths] of Object.entries(aeMap)) {
        const authorsContracted = auths.filter(a => {
          const d = a.firstContractDate;
          return d && String(d).slice(0, 10) < earliestStart;
        }).length;
        const s1 = auths.filter(a => isInAnyMonth(a.firstContractDate)).length;
        const s2 = auths.filter(a => isInAnyMonth(a.first300kWordDate)).length;
        const s3 = Math.floor((authorsContracted + s1) / 10) - Math.floor(authorsContracted / 10);
        const earnings = s1 * 50 + s2 * 200 + s3 * 100;
        rows.push({ aeEmail, authorsContracted, stage1Cleared: s1, stage2Cleared: s2, stage3Cleared: s3, earnings, payment: '' });
      }

      res.json({ data: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
