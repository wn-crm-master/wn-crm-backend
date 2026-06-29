const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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

function register(app, getDb, JWT_SECRET) {
  app.post('/api/auth/register', async (req, res) => {
    try {
      const db = getDb();
      const { email, password, name } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      const existing = await db.collection('users').findOne({ email });
      if (existing) return res.status(400).json({ error: 'User already exists' });
      const hash = await bcrypt.hash(password, 10);
      const result = await db.collection('users').insertOne({ email, password: hash, name, createdAt: new Date() });
      const token = jwt.sign({ userId: result.insertedId, email }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, user: { id: result.insertedId, email, name } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

module.exports = { createAuthMiddleware, register };
