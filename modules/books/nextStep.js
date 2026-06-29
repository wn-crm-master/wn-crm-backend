// Book Journey: Created → Chp1 Published → 10k Words → Moderation
//
// Rules:
// 1. Book creation is step 1 — every book in the list has been created.
// 2. If chp1Published is not true AND chp1PublishedDate is blank → stuck at "Awaiting Chp 1"
// 3. If pubWC < 10,000 (words10kCompleted not true) → "Awaiting 10k Words"
// 4. If 10k done and moderationStatus = "Passed" or "Moderation Passed" → "Mod Passed ✓"
// 5. If 10k done and moderationStatus = "Failed" or "Moderation Failed" → "Mod Failed"
// 6. If 10k done but moderation not yet decided → "Awaiting Moderation"

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
  if (!isChp1Published(row)) return { label: 'Awaiting Chp 1', css: 'step-awaiting', alarm: 'pending' };
  if (!isTruthy(row.words10kCompleted)) return { label: 'Awaiting 10k Words', css: 'step-awaiting', alarm: 'pending' };
  const modStatus = String(row.moderationStatus || '').trim().toLowerCase();
  if (modStatus === 'passed' || modStatus === 'moderation passed') return { label: 'Mod Passed ✓', css: 'step-done', alarm: null };
  if (modStatus === 'failed' || modStatus === 'moderation failed') return { label: 'Mod Failed', css: 'step-failed', alarm: 'urgent' };
  return { label: 'Awaiting Moderation', css: 'step-awaiting', alarm: 'pending' };
}

module.exports = { getBookNextStep, isChp1Published, isTruthy, isBlankish };
