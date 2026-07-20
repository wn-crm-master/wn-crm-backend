const crypto = require('crypto');

const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || 'WN CRM';
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

async function resendFetch(method, path, body) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || json?.error || `Resend error ${res.status}`);
  return json;
}

function applyTemplate(text, r) {
  return text
    .replace(/\{\{name\}\}/gi, r.name || '')
    .replace(/\{\{email\}\}/gi, r.email || '')
    .replace(/\{\{uid\}\}/gi, r.uid || '');
}

function toHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function register(app, getDb, authMiddleware) {

  // List campaigns
  app.get('/api/emails/campaigns', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const data = await db.collection('email_campaigns').find({}).sort({ createdAt: -1 }).limit(200).toArray();
      res.json({ data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Sends for a campaign
  app.get('/api/emails/campaigns/:id/sends', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const data = await db.collection('email_sends').find({ campaignId: req.params.id }).sort({ createdAt: 1 }).toArray();
      res.json({ data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Mark replied
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

  // Send campaign (fire-and-forget)
  app.post('/api/emails/send', authMiddleware, async (req, res) => {
    try {
      if (!process.env.RESEND_API_KEY) return res.status(400).json({ error: 'RESEND_API_KEY not configured on server' });
      const db = getDb();
      const { subject, body, recipients } = req.body;
      if (!subject || !body || !Array.isArray(recipients) || !recipients.length)
        return res.status(400).json({ error: 'subject, body, and recipients required' });

      const campaignId = crypto.randomBytes(12).toString('hex');
      await db.collection('email_campaigns').insertOne({
        id: campaignId, subject, body,
        recipientCount: recipients.length, sentCount: 0, failedCount: 0,
        openedCount: 0, repliedCount: 0,
        status: 'sending', createdAt: new Date()
      });

      res.json({ success: true, campaignId, total: recipients.length });

      sendEmails(db, campaignId, subject, body, recipients).catch(err => {
        console.error('Campaign send error:', err.message);
        db.collection('email_campaigns').updateOne({ id: campaignId }, { $set: { status: 'error', error: err.message } });
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Resend webhook (open tracking)
  app.post('/api/email/webhook', async (req, res) => {
    res.json({ ok: true });
    try {
      const db = getDb();
      const { type, data } = req.body || {};
      if (type !== 'email.opened' || !data?.email_id) return;
      const send = await db.collection('email_sends').findOneAndUpdate(
        { resendId: data.email_id, opened: { $ne: true } },
        { $set: { opened: true, openedAt: new Date() } }
      );
      const s = send?.value || send;
      if (s?.campaignId) {
        await db.collection('email_campaigns').updateOne({ id: s.campaignId }, { $inc: { openedCount: 1 } });
      }
    } catch (err) { console.error('Webhook error:', err.message); }
  });
}

async function sendEmails(db, campaignId, subject, body, recipients) {
  const BATCH = 50;
  let sentCount = 0, failedCount = 0;

  for (let i = 0; i < recipients.length; i += BATCH) {
    const slice = recipients.slice(i, i + BATCH);

    const sends = slice.map(r => ({
      id: crypto.randomBytes(8).toString('hex'),
      campaignId,
      email: r.email,
      name: r.name || '',
      uid: r.uid || '',
      resendId: null,
      opened: false,
      replied: false,
      failed: false,
      createdAt: new Date(),
    }));
    await db.collection('email_sends').insertMany(sends, { ordered: false }).catch(() => {});

    const batch = sends.map((s, j) => ({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM}>`,
      to: [s.email],
      subject,
      html: toHtml(applyTemplate(body, slice[j])),
      text: applyTemplate(body, slice[j]),
      tags: [{ name: 'sendId', value: s.id }],
    }));

    try {
      const result = await resendFetch('POST', '/emails/batch', batch);
      const ids = Array.isArray(result?.data) ? result.data : [];
      for (let j = 0; j < ids.length; j++) {
        if (ids[j]?.id && sends[j]?.id) {
          await db.collection('email_sends').updateOne({ id: sends[j].id }, { $set: { resendId: ids[j].id } });
        }
      }
      sentCount += ids.length;
    } catch (err) {
      failedCount += slice.length;
      await db.collection('email_sends').updateMany(
        { id: { $in: sends.map(s => s.id) } },
        { $set: { failed: true, error: err.message } }
      );
    }

    await db.collection('email_campaigns').updateOne({ id: campaignId }, { $set: { sentCount, failedCount } });
    if (i + BATCH < recipients.length) await new Promise(r => setTimeout(r, 200));
  }

  await db.collection('email_campaigns').updateOne(
    { id: campaignId },
    { $set: { status: 'sent', sentAt: new Date(), sentCount, failedCount } }
  );
}

module.exports = { register };
