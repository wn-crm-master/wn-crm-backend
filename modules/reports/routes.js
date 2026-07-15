function register(app, getDb, authMiddleware) {

  app.post('/api/reports/stage-summary', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { month } = req.body;

      const match = {};
      if (month) match.createMonth = month;

      const docs = await db.collection('books').find(match, {
        projection: { _id: 0, stage: 1 }
      }).toArray();

      const counts = {};
      for (const d of docs) {
        const s = d.stage || 'Unknown';
        counts[s] = (counts[s] || 0) + 1;
      }

      res.json({ data: counts, total: docs.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/reports/stage-months', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const months = await db.collection('books').distinct('createMonth');
      const sorted = months.filter(m => m && String(m).trim()).sort().reverse();
      res.json({ months: sorted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
