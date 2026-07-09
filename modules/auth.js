const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SEED_USERS = [
  { email: 'pal.mohit@pocketfm.com', password: 'Pocketfm@2026', name: 'Mohit Pal' },
  { email: 'vatsal.rustagi@pocketfm.com', password: 'Pocketfm@2026', name: 'Vatsal Rustagi' },
  { email: 'lalit@pocketfm.com', password: 'Pocketfm@2026', name: 'Lalit' },
  { email: 'prateek@pocketfm.com', password: 'Pocketfm@2026', name: 'Prateek' },
  { email: 'rohan@pocketfm.com', password: 'Pocketfm@2026', name: 'Rohan' },
  { email: 'alok.birthare@pocketfm.com', password: 'Pocketfm@2026', name: 'Alok Birthare' },
  { email: 'nivesh.aron@pocketfm.com', password: 'Pocketfm@2026', name: 'Nivesh Aron' },
];

function createAuthMiddleware(JWT_SECRET) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

async function seedUsers(db) {
  for (const u of SEED_USERS) {
    const existing = await db.collection('users').findOne({ email: u.email });
    if (!existing) {
      const hash = await bcrypt.hash(u.password, 10);
      await db.collection('users').insertOne({ email: u.email, password: hash, name: u.name, createdAt: new Date() });
      console.log('Seeded user:', u.email);
    }
  }
}

function register(app, getDb, JWT_SECRET) {
  app.post('/api/auth/login', async (req, res) => {
    try {
      const db = getDb();
      const { email, password } = req.body;
      const user = await db.collection('users').findOne({ email });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, user: { id: user._id, email: user.email, name: user.name } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { createAuthMiddleware, seedUsers, register };
