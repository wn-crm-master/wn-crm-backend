// Book Journey: Dead checks → Chp1 → 10k Words → Moderation → Form 2 cycle → 50k Words
//
// Rules (checked in order):
// 0a. If book status is NOT approved/published/draft → dead (reason: book status)
// 0b. If show status is NOT active → dead (reason: show status)
// 0c. If PPV Tag is bad/average → dead (reason: PPV)
// 1.  If chp1 not published → "Awaiting Chp 1"
// 2.  If pubWC < 10k → "Awaiting 10k Words"
// 3.  Moderation check:
//     - Failed → "Mod Failed"
//     - Not decided → "Awaiting Moderation"
//     - Passed + editorScore=10 + pubWC>10k + pre-contracted → Form 2 cycle
//     - Passed otherwise → "Mod Passed ✓" or "Awaiting 50k Words"
// 4.  Form 2 cycle (pre-contracted path):
//     - Form 2 Recd → done (fall through to 50k check or complete)
//     - FU2 sent, >=4 days ago → "Awaiting Form 2 Response or 50k Words"
//     - FU2 sent, <4 days → "Awaiting Form 2 Response"
//     - FU1 sent, >=3 days ago → "Send Form 2 Follow Up 2" (alarm)
//     - FU1 sent, <3 days → "Awaiting Form 2 Response"
//     - Form 2 sent, >=2 days ago → "Send Form 2 Follow Up 1" (alarm)
//     - Form 2 sent, <2 days → "Awaiting Form 2 Response"
//     - Form 2 not sent → "Send Form 2"

const ALIVE_BOOK_STATUSES = new Set(['approved', 'published', 'draft']);

function isBlankish(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  return s === '' || s === 'null' || s === 'undefined';
}

function isTruthy(val) {
  if (val === true || val === 1) return true;
  return ['true', 'yes', 'y', '1', 'x', '✓'].includes(String(val).trim().toLowerCase());
}

function isChp1Published(row) {
  return isTruthy(row.chp1Published) || (row.chp1PublishedDate && !isBlankish(row.chp1PublishedDate));
}

function daysAgo(dateVal) {
  if (isBlankish(dateVal)) return -1;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return -1;
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function getForm2Step(row) {
  if (!isBlankish(row.form2RecdDate)) return null;

  const fu2Days = daysAgo(row.form2FollowUp2Date);
  if (fu2Days >= 0) {
    if (fu2Days >= 4) return { label: 'Awaiting Form 2 Response or 50k Words', css: 'step-awaiting', alarm: 'pending' };
    return { label: 'Awaiting Form 2 Response', css: 'step-awaiting', alarm: 'pending' };
  }

  const fu1Days = daysAgo(row.form2FollowUp1Date);
  if (fu1Days >= 0) {
    if (fu1Days >= 3) return { label: 'Send Form 2 Follow Up 2', css: 'step-action', alarm: 'urgent' };
    return { label: 'Awaiting Form 2 Response', css: 'step-awaiting', alarm: 'pending' };
  }

  const sentDays = daysAgo(row.form2SentDate);
  if (sentDays >= 0) {
    if (sentDays >= 2) return { label: 'Send Form 2 Follow Up 1', css: 'step-action', alarm: 'urgent' };
    return { label: 'Awaiting Form 2 Response', css: 'step-awaiting', alarm: 'pending' };
  }

  return { label: 'Send Form 2', css: 'step-action', alarm: 'pending' };
}

function getBookNextStep(row) {
  const bookStatus = String(row.status || '').trim().toLowerCase();
  if (bookStatus && !ALIVE_BOOK_STATUSES.has(bookStatus)) {
    return { label: 'Dead — Book ' + (row.status || ''), css: 'step-dead', alarm: 'dead' };
  }

  const showStatus = String(row.showStatus || '').trim().toLowerCase();
  if (showStatus && showStatus !== 'active') {
    return { label: 'Dead — Show ' + (row.showStatus || ''), css: 'step-dead', alarm: 'dead' };
  }

  const ppv = String(row.ppvTag || '').trim().toLowerCase();
  if (ppv === 'bad' || ppv === 'average') {
    return { label: 'Dead — PPV ' + (row.ppvTag || ''), css: 'step-dead', alarm: 'dead' };
  }

  if (!isChp1Published(row)) return { label: 'Awaiting Chp 1', css: 'step-awaiting', alarm: 'pending' };
  if (!isTruthy(row.words10kCompleted)) return { label: 'Awaiting 10k Words', css: 'step-awaiting', alarm: 'pending' };

  const modStatus = String(row.moderationStatus || '').trim().toLowerCase();
  if (['passed','moderation passed','moderation_passed'].includes(modStatus)) {
    const edScore = Number(row.editorScore);
    const wc = typeof row.pubWC === 'number' ? row.pubWC : parseInt(String(row.pubWC || '').replace(/,/g, ''), 10);
    if (edScore === 10 && !isNaN(wc) && wc > 10000) {
      const preContract = String(row.authorPreContract || '').trim().toLowerCase();
      if (preContract && preContract !== '' && preContract !== 'no' && preContract !== 'false') {
        const form2 = getForm2Step(row);
        if (form2) return form2;
      }
      return { label: 'Awaiting 50k Words', css: 'step-awaiting', alarm: 'pending' };
    }
    return { label: 'Mod Passed ✓', css: 'step-done', alarm: null };
  }
  if (['failed','moderation failed','moderation_failed'].includes(modStatus)) return { label: 'Mod Failed', css: 'step-failed', alarm: 'urgent' };
  return { label: 'Awaiting Moderation', css: 'step-awaiting', alarm: 'pending' };
}

module.exports = { getBookNextStep, isChp1Published, isTruthy, isBlankish };
