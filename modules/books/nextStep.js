// Book Journey: Book Status → Show Status → Chp1 Published → 10k Words → Moderation
//
// Rules (checked in order):
// 0a. If book status is NOT "approved" or "published" → dead book (reason: book status)
// 0b. If show status is NOT "active" → dead show (reason: show status)
// 0c. If PPV Tag is "bad" or "average" → dead book (reason: PPV)
// 1.  Book creation is step 1 — every book in the list has been created.
// 2.  If chp1Published is not true AND chp1PublishedDate is blank → "Awaiting Chp 1"
// 3.  If pubWC < 10,000 (words10kCompleted not true) → "Awaiting 10k Words"
// 4.  If 10k done and moderationStatus passed AND editorScore=10 AND pubWC>10k:
//     4a. If author is pre-contracted → "Send Form 2"
//     4b. If not pre-contracted → "Awaiting 50k Words"
// 5.  If 10k done and moderationStatus = "Passed" (but editor/WC not met) → "Mod Passed ✓"
// 6.  If 10k done and moderationStatus = "Failed"/"Moderation Failed" → "Mod Failed"
// 7.  If 10k done but moderation not yet decided → "Awaiting Moderation"

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
        return { label: 'Send Form 2', css: 'step-action', alarm: 'pending' };
      }
      return { label: 'Awaiting 50k Words', css: 'step-awaiting', alarm: 'pending' };
    }
    return { label: 'Mod Passed ✓', css: 'step-done', alarm: null };
  }
  if (['failed','moderation failed','moderation_failed'].includes(modStatus)) return { label: 'Mod Failed', css: 'step-failed', alarm: 'urgent' };
  return { label: 'Awaiting Moderation', css: 'step-awaiting', alarm: 'pending' };
}

module.exports = { getBookNextStep, isChp1Published, isTruthy, isBlankish };
