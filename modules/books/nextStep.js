// Book Journey: Book Status → Show Status → Chp1 Published → 10k Words → Moderation
//
// Rules (checked in order):
// 0a. If book status is NOT "approved" or "published" → dead book (reason: book status)
// 0b. If show status is NOT "active" → dead show (reason: show status)
// 1.  Book creation is step 1 — every book in the list has been created.
// 2.  If chp1Published is not true AND chp1PublishedDate is blank → "Awaiting Chp 1"
// 3.  If pubWC < 10,000 (words10kCompleted not true) → "Awaiting 10k Words"
// 4.  If 10k done and moderationStatus = "Passed"/"Moderation Passed" → "Mod Passed ✓"
// 5.  If 10k done and moderationStatus = "Failed"/"Moderation Failed" → "Mod Failed"
// 6.  If 10k done but moderation not yet decided → "Awaiting Moderation"

const ALIVE_BOOK_STATUSES = new Set(['approved', 'published']);

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

function getBookNextStep(row) {
  const bookStatus = String(row.status || '').trim().toLowerCase();
  if (bookStatus && !ALIVE_BOOK_STATUSES.has(bookStatus)) {
    return { label: 'Dead — Book ' + (row.status || ''), css: 'step-dead', alarm: 'dead' };
  }

  const showStatus = String(row.showStatus || '').trim().toLowerCase();
  if (showStatus && showStatus !== 'active') {
    return { label: 'Dead — Show ' + (row.showStatus || ''), css: 'step-dead', alarm: 'dead' };
  }

  if (!isChp1Published(row)) return { label: 'Awaiting Chp 1', css: 'step-awaiting', alarm: 'pending' };
  if (!isTruthy(row.words10kCompleted)) return { label: 'Awaiting 10k Words', css: 'step-awaiting', alarm: 'pending' };

  const modStatus = String(row.moderationStatus || '').trim().toLowerCase();
  if (modStatus === 'passed' || modStatus === 'moderation passed') return { label: 'Mod Passed ✓', css: 'step-done', alarm: null };
  if (modStatus === 'failed' || modStatus === 'moderation failed') return { label: 'Mod Failed', css: 'step-failed', alarm: 'urgent' };
  return { label: 'Awaiting Moderation', css: 'step-awaiting', alarm: 'pending' };
}

module.exports = { getBookNextStep, isChp1Published, isTruthy, isBlankish };
