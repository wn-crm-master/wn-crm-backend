const crypto = require('crypto');

const FROM_NAME = process.env.BREVO_FROM_NAME || process.env.RESEND_FROM_NAME || 'WN CRM';
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || '';

async function brevoSend(payload) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not configured');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || `Brevo error ${res.status}`);
  return json; // { messageId: '...' }
}

function applyTemplate(text, r) {
  return text
    .replace(/\{\{name\}\}/gi, r.name || '')
    .replace(/\{\{email\}\}/gi, r.email || '')
    .replace(/\{\{uid\}\}/gi, r.uid || '');
}

function toHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function register(app, getDb, authMiddleware) {

  // Templates
  app.get('/api/emails/templates', authMiddleware, async (req, res) => {
    try {
      const data = await getDb().collection('email_templates').find({}).sort({ createdAt: -1 }).toArray();
      res.json({ data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/emails/templates', authMiddleware, async (req, res) => {
    try {
      const { name, subject, body } = req.body;
      if (!name || !subject || !body) return res.status(400).json({ error: 'name, subject, body required' });
      const id = crypto.randomBytes(8).toString('hex');
      const doc = { id, name, subject, body, createdAt: new Date(), updatedAt: new Date() };
      await getDb().collection('email_templates').insertOne(doc);
      res.json({ success: true, id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/emails/templates/:id', authMiddleware, async (req, res) => {
    try {
      const { name, subject, body } = req.body;
      if (!name || !subject || !body) return res.status(400).json({ error: 'name, subject, body required' });
      await getDb().collection('email_templates').updateOne(
        { id: req.params.id },
        { $set: { name, subject, body, updatedAt: new Date() } }
      );
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/emails/templates/:id', authMiddleware, async (req, res) => {
    try {
      await getDb().collection('email_templates').deleteOne({ id: req.params.id });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/emails/campaigns', authMiddleware, async (req, res) => {
    try {
      const data = await getDb().collection('email_campaigns').find({}).sort({ createdAt: -1 }).limit(200).toArray();
      res.json({ data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/emails/campaigns/:id/sends', authMiddleware, async (req, res) => {
    try {
      const data = await getDb().collection('email_sends').find({ campaignId: req.params.id }).sort({ createdAt: 1 }).toArray();
      res.json({ data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/emails/sends/:id/replied', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const send = await db.collection('email_sends').findOne({ id: req.params.id });
      if (!send) return res.status(404).json({ error: 'Not found' });
      if (send.replied) return res.json({ success: true });
      await db.collection('email_sends').updateOne({ id: req.params.id }, { $set: { replied: true, repliedAt: new Date() } });
      await db.collection('email_campaigns').updateOne({ id: send.campaignId }, { $inc: { repliedCount: 1 } });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/emails/send', authMiddleware, async (req, res) => {
    try {
      if (!process.env.BREVO_API_KEY) return res.status(400).json({ error: 'BREVO_API_KEY not configured on server' });
      if (!FROM_EMAIL) return res.status(400).json({ error: 'BREVO_FROM_EMAIL not configured on server' });
      const { subject, body, recipients } = req.body;
      if (!subject || !body || !Array.isArray(recipients) || !recipients.length)
        return res.status(400).json({ error: 'subject, body, and recipients required' });

      const campaignId = crypto.randomBytes(12).toString('hex');
      await getDb().collection('email_campaigns').insertOne({
        id: campaignId, subject, body,
        recipientCount: recipients.length, sentCount: 0, failedCount: 0,
        openedCount: 0, repliedCount: 0,
        status: 'sending', createdAt: new Date(),
      });

      res.json({ success: true, campaignId, total: recipients.length });

      sendEmails(getDb(), campaignId, subject, body, recipients).catch(err => {
        console.error('Campaign send error:', err.message);
        getDb().collection('email_campaigns').updateOne({ id: campaignId }, { $set: { status: 'error', error: err.message } });
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Brevo webhook — open tracking
  // Register in Brevo dashboard: Transactional → Settings → Webhook → add your URL for "opened" event
  app.post('/api/email/webhook', async (req, res) => {
    res.json({ ok: true });
    try {
      const db = getDb();
      const events = Array.isArray(req.body) ? req.body : [req.body];
      for (const evt of events) {
        if (evt.event !== 'opened' || !evt.messageId) continue;
        const send = await db.collection('email_sends').findOneAndUpdate(
          { brevoId: evt.messageId, opened: { $ne: true } },
          { $set: { opened: true, openedAt: new Date() } }
        );
        const s = send?.value || send;
        if (s?.campaignId) {
          await db.collection('email_campaigns').updateOne({ id: s.campaignId }, { $inc: { openedCount: 1 } });
        }
      }
    } catch (err) { console.error('Webhook error:', err.message); }
  });
}

async function sendEmails(db, campaignId, subject, body, recipients) {
  let sentCount = 0, failedCount = 0;

  for (const r of recipients) {
    const sendId = crypto.randomBytes(8).toString('hex');
    const sendDoc = {
      id: sendId, campaignId,
      email: r.email, name: r.name || '', uid: r.uid || '',
      brevoId: null, opened: false, replied: false, failed: false,
      createdAt: new Date(),
    };
    await db.collection('email_sends').insertOne(sendDoc).catch(() => {});

    try {
      const result = await brevoSend({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: r.email, name: r.name || r.email }],
        subject,
        htmlContent: toHtml(applyTemplate(body, r)),
        textContent: applyTemplate(body, r),
        tags: [campaignId],
      });
      await db.collection('email_sends').updateOne({ id: sendId }, { $set: { brevoId: result.messageId || null } });
      sentCount++;
    } catch (err) {
      await db.collection('email_sends').updateOne({ id: sendId }, { $set: { failed: true, error: err.message } });
      failedCount++;
    }

    await db.collection('email_campaigns').updateOne({ id: campaignId }, { $set: { sentCount, failedCount } });
    // Brevo free: ~3 emails/sec max; 350ms keeps us safe
    await new Promise(r => setTimeout(r, 350));
  }

  await db.collection('email_campaigns').updateOne(
    { id: campaignId },
    { $set: { status: 'sent', sentAt: new Date(), sentCount, failedCount } }
  );
}

module.exports = { register };
