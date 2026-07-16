const { google } = require('googleapis');

function getAuthClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');
  const creds = JSON.parse(json);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
}

async function createLlmSheet(books) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive  = google.drive({ version: 'v3', auth });

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const title = `1hr LLM Queue — ${today}`;

  // Create a new spreadsheet
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: 'Queue' } }],
    },
  });
  const spreadsheetId = created.data.spreadsheetId;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  // Write header + data rows
  const header = ['Date', 'Author ID', 'Book ID', 'Book Title', 'Show ID'];
  const rows = books.map(b => [today, b.authorId || '', b.id || '', b.title || '', b.showId || '']);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Queue!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [header, ...rows] },
  });

  // Bold + freeze the header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.16, blue: 0.18 } } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      ],
    },
  });

  // Share the sheet so anyone with the link can view
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return sheetUrl;
}

function register(app, getDb, authMiddleware) {
  app.post('/api/books/llm-sheet', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { ids } = req.body;
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });

      const books = await db.collection('books')
        .find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, title: 1, authorId: 1, showId: 1 } })
        .toArray();

      const sheetUrl = await createLlmSheet(books);
      res.json({ success: true, sheetUrl });
    } catch (err) {
      console.error('LLM sheet error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
