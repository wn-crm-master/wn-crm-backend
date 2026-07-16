const { google } = require('googleapis');
const cron = require('node-cron');

const SPREADSHEET_ID = '12XBz_ly_T1Fb-MYbTo5llDnYx9jMxBjYcKhyQQNfDzU';
const SHEET_RANGE = "'Form Responses 1'!A:C";

function parseServiceAccountKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getSheetsClient() {
  const key = parseServiceAccountKey();
  if (!key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env var not set or invalid');
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function fetchFormResponses() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: SHEET_RANGE,
  });
  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  const dataRows = rows.slice(1);
  const bookMap = new Map();

  for (const row of dataRows) {
    const dateStr = (row[0] || '').trim();
    const bookName = (row[2] || '').trim();
    if (!dateStr || !bookName) continue;

    const key = bookName.toLowerCase();
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;

    const existing = bookMap.get(key);
    if (!existing || d > existing.date) {
      bookMap.set(key, { date: d, bookName });
    }
  }

  return Array.from(bookMap.values());
}

function toDateString(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function syncForm2Dates(db) {
  const responses = await fetchFormResponses();
  if (!responses.length) return { matched: 0, updated: 0, unmatched: 0 };

  const books = await db.collection('books').find({}, { projection: { _id: 0, id: 1, title: 1, form2RecdDate: 1 } }).toArray();

  const titleIndex = new Map();
  for (const book of books) {
    const title = (book.title || '').trim().toLowerCase();
    if (title) titleIndex.set(title, book);
  }

  let matched = 0, updated = 0, unmatched = 0;
  const unmatchedNames = [];

  for (const resp of responses) {
    const key = resp.bookName.toLowerCase();
    const book = titleIndex.get(key);
    if (!book) {
      unmatched++;
      unmatchedNames.push(resp.bookName);
      continue;
    }
    matched++;
    const newDate = toDateString(resp.date);
    const existingDate = (book.form2RecdDate || '').trim();
    if (existingDate === newDate) continue;

    await db.collection('books').updateOne(
      { _id: book._id },
      { $set: { form2RecdDate: newDate, updatedAt: new Date() } }
    );
    updated++;
  }

  return { matched, updated, unmatched, unmatchedNames };
}

function startScheduledSync(getDb) {
  const key = parseServiceAccountKey();
  if (!key) {
    console.log('Sheet sync disabled: GOOGLE_SERVICE_ACCOUNT_KEY not configured');
    return;
  }

  cron.schedule('0 9 * * *', async () => {
    console.log('Running scheduled Form 2 sheet sync...');
    try {
      const db = getDb();
      if (!db) { console.error('Sheet sync: DB not connected'); return; }
      const result = await syncForm2Dates(db);
      console.log('Sheet sync complete:', result);
    } catch (err) {
      console.error('Sheet sync error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('Sheet sync scheduled: daily at 9:00 AM IST');
}

function register(app, getDb, authMiddleware) {
  app.post('/api/sync/form2', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      if (!db) return res.status(503).json({ error: 'Database not available' });
      const result = await syncForm2Dates(db);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register, startScheduledSync, syncForm2Dates };
