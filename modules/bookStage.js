// Server-side mirror of the book Stage decision table (public/index.html's
// former client-only getBookStage). Computing this once at write-time and
// storing it on the book document lets Mongo filter/sort/paginate/count on
// Stage exactly like any other column — a client-computed virtual column
// can only ever be filtered within whatever page happens to be loaded.

function isBlankish(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  return s === '' || s === 'null' || s === 'undefined';
}

function inList(val, csv) {
  const v = String(val || '').trim().toLowerCase();
  return csv.split(',').map(s => s.trim().toLowerCase()).includes(v);
}

// Dates in this app come from two sources: ISO (YYYY-MM-DD, from <input
// type=date>) and DD/MM/YYYY (raw strings from CSV import). JS's Date
// constructor treats slash-separated dates as MM/DD/YYYY, so any imported
// date with day > 12 (e.g. 13/07/2026) silently fails to parse. Mirror the
// client's formatDate() dual-format handling here so Create Month and
// days-in-stage calculations don't go blank/wrong for imported dates.
function parseFlexibleDate(val) {
  if (isBlankish(val)) return null;
  const s = String(val).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function daysAgo(dateVal, now) {
  const d = parseFlexibleDate(dateVal);
  if (!d) return -1;
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function computeBookStage(row) {
  const updDate = row.updatedAt || row.createDate;

  // Step 1-2: Dead flow (highest priority, supersedes all else)
  const bookStatus = String(row.status || '').trim().toLowerCase();
  if (inList(bookStatus, 'disabled, draft, pending, unpublished, user_deleted')) {
    return { stage: 'Dead - Book Status = ' + (row.status || ''), sinceDate: updDate, imp: 'high' };
  }
  const showStatus = String(row.showStatus || '').trim().toLowerCase();
  if (inList(showStatus, 'disabled, draft, pending, unpublished, user_deleted')) {
    return { stage: 'Dead - Show Status = ' + (row.showStatus || ''), sinceDate: updDate, imp: 'high' };
  }

  // Step 3-6: PPV Failed flow (second priority)
  const ppv = String(row.ppvTag || '').trim().toLowerCase();
  const manualCheck = String(row.ppvManualCheck || '').trim();
  if (ppv === 'bad') {
    if (isBlankish(manualCheck)) return { stage: 'Check - PPV Bad', sinceDate: row.ppvBadDate, imp: 'high' };
    if (manualCheck.toLowerCase() === 'retained bad') return { stage: 'PPV Bad', sinceDate: row.ppvManualCheckDate, imp: 'medium' };
  }
  if (ppv === 'average') {
    if (isBlankish(manualCheck)) return { stage: 'Check - PPV Average', sinceDate: row.ppvAvgDate, imp: 'high' };
    if (manualCheck.toLowerCase() === 'retained average') return { stage: 'PPV Avg', sinceDate: row.ppvManualCheckDate, imp: 'medium' };
  }

  // Step 27-28: WBP contracting status (Flow A/B, independent of word-count
  // bucket — once contracting is underway it takes priority over whatever
  // stage the word count would otherwise imply).
  const wbpStatusEarly = String(row.wbpStatus || '').trim().toLowerCase();
  const wbpSubEarly = String(row.wbpSubStatus || '').trim().toLowerCase();
  if (wbpStatusEarly === 'ongoing') {
    if (wbpSubEarly === 'signing_pending') {
      return { stage: 'Signing Pending', sinceDate: row.wbpOngoingDate, imp: 'medium' };
    }
    if (inList(wbpSubEarly, 'open_for_withdrawal, open_for_wsigithdrawal')) {
      return { stage: 'OFW', sinceDate: row.ofwDate, imp: 'low' };
    }
    return { stage: 'WBP Ongoing', sinceDate: row.wbpOngoingDate, imp: 'medium' };
  }
  // Step 34: Contract Rejected
  if (wbpStatusEarly === 'rejected') {
    return { stage: 'Contract Rejected', sinceDate: row.wbpRejectedDate, imp: 'high' };
  }

  // Step 7-8: Flow A / Flow B determination
  const pc = String(row.authorPreContract || '').trim().toLowerCase();
  const isFlowA = inList(pc, 'pre-contracted, pre-contracted (w/ other proof)');

  const wcRaw = typeof row.pubWC === 'number' ? row.pubWC : parseInt(String(row.pubWC || '').replace(/,/g, ''), 10);
  const wc = isNaN(wcRaw) ? 0 : wcRaw;

  // Step 9: Awaiting Chp 1 (Pub WC = 0/blank AND Chp 1 Published Date blank)
  if (wc === 0 && isBlankish(row.chp1PublishedDate)) {
    return { stage: 'Awaiting Chp 1', sinceDate: row.createDate, imp: 'low' };
  }
  // Step 10: Awaiting 10k
  if (wc < 10000) {
    return { stage: 'Awaiting 10k', sinceDate: row.chp1PublishedDate, imp: 'low' };
  }

  const modStatus = String(row.moderationStatus || '').trim().toLowerCase();
  const modPending = isBlankish(modStatus) || inList(modStatus, 'in progress, moderation_pending_or_missing, null, pending');
  const modFailed = inList(modStatus, 'failed, moderation_failed');
  const modPassed = inList(modStatus, 'moderation_passed, passed');

  // Step 11: Awaiting Moderation
  if (wc >= 10000 && modPending) {
    return { stage: 'Awaiting Moderation', sinceDate: row.words10kDate, imp: 'medium' };
  }
  // Step 12: Mod Failed
  if (wc >= 10000 && modFailed) {
    return { stage: 'Mod Failed', sinceDate: row.moderationPassedDate, imp: 'high' };
  }

  const edScore = Number(row.editorScore);
  // Step 13: Check BES <> 10 (wc>=10k)
  if (wc >= 10000 && modPassed && edScore !== 10) {
    return { stage: 'Check BES <> 10', sinceDate: row.moderationPassedDate, imp: 'high' };
  }
  // Step 14: Check Mod Passed Pub WC <10k
  if (wc < 10000 && modPassed) {
    return { stage: 'Check Mod Passed Pub WC <10k', sinceDate: row.moderationPassedDate, imp: 'high' };
  }
  if (!modPassed) {
    return { stage: 'Awaiting Moderation', sinceDate: row.words10kDate, imp: 'medium' };
  }

  // Step 15: from here Flow A & Flow B differ (10k<=wc<50k)
  if (wc >= 10000 && wc < 50000) {
    if (isFlowA) {
      const llmSent1 = row.llmSentDate1hr, llmRecd1 = row.llmRecdDate1hr;
      const llmDec1 = String(row.llmDecision1hr || '').trim().toLowerCase();
      if (isBlankish(llmSent1)) return { stage: 'Send For 1 Hr LLM Score', sinceDate: row.moderationPassedDate, imp: 'medium' };
      if (isBlankish(llmRecd1)) return { stage: 'Awaiting 1 Hr LLM', sinceDate: llmSent1, imp: 'medium' };
      if (llmDec1 === 'reject') return { stage: 'Check - 1 Hr LLM Failed', sinceDate: llmRecd1, imp: 'high' };
      if (isBlankish(row.form2SentDate)) return { stage: 'Send Addn Details Form', sinceDate: llmRecd1, imp: 'medium' };
      if (isBlankish(row.form2FollowUp1Date)) return { stage: 'Awaiting Addn Details', sinceDate: row.form2SentDate, imp: 'medium' };
      if (isBlankish(row.form2FollowUp2Date)) return { stage: 'Awaiting Addn Details', sinceDate: row.form2FollowUp1Date, imp: 'medium' };
      if (isBlankish(row.form2RecdDate)) return { stage: 'Awaiting Addn Details', sinceDate: row.form2FollowUp2Date, imp: 'medium' };
      if (isBlankish(row.dateAddedForReview)) return { stage: 'Send For Review', sinceDate: row.form2RecdDate, imp: 'medium' };
      if (isBlankish(row.reviewCompDate)) return { stage: 'Awaiting Review', sinceDate: row.dateAddedForReview, imp: 'medium' };
      const contractingDecision = String(row.contractingDecision || '').trim().toLowerCase();
      if (contractingDecision === 'yes' && isBlankish(row.sentForContractingDate)) {
        return { stage: 'Send for Contracting', sinceDate: row.reviewCompDate, imp: 'medium' };
      }
      // wbpStatusEarly/wbpSubEarly above already handled the 'ongoing' case
      // (Signing Pending / OFW), so reaching here means WBP isn't ongoing yet.
      if (!isBlankish(row.sentForContractingDate)) {
        return { stage: 'Awaiting Program ID', sinceDate: row.sentForContractingDate, imp: 'medium' };
      }
      return { stage: 'Awaiting Review', sinceDate: row.dateAddedForReview, imp: 'medium' };
    } else {
      // Step 29: Awaiting 50k (Flow B)
      return { stage: 'Awaiting 50k', sinceDate: row.words10kDate, imp: 'low' };
    }
  }

  // Step 30-33: wc >= 50000, Flow A & B merge again
  if (wc >= 50000) {
    if (isBlankish(row.llmScore5hr)) return { stage: 'Awaiting 5 hr LLM', sinceDate: row.words50kDate, imp: 'medium' };
    const dec5 = String(row.llmDecision5hr || '').trim().toLowerCase();
    if (!isBlankish(row.llmDate5hr) && dec5 === 'reject') {
      return { stage: '5 Hr LLM Rejected', sinceDate: row.llmDate5hr, imp: 'high' };
    }
    if (!isBlankish(row.llmDate5hr) && dec5 === 'pass') {
      const ppvState = String(row.ppvTag || '').trim().toLowerCase();
      if (isBlankish(ppvState) || ppvState === 'untested') {
        return { stage: 'Send for PPV Testing', sinceDate: row.llmDate5hr, imp: 'medium' };
      }
      return { stage: 'Awaiting Testing Results', sinceDate: row.ppvTagDate, imp: 'low' };
    }
    return { stage: 'Awaiting 5 hr LLM', sinceDate: row.words50kDate, imp: 'medium' };
  }

  return { stage: 'Mod Passed', sinceDate: row.moderationPassedDate, imp: 'low' };
}

function computeBookUrg(stageObj, now) {
  const days = stageObj.sinceDate ? daysAgo(stageObj.sinceDate, now) : -1;
  if (days < 0) return 'low';
  const s = stageObj.stage;
  if (s.startsWith('Dead')) return days > 3 ? 'high' : days > 1 ? 'medium' : 'low';
  if (s.includes('PPV')) return days > 3 ? 'high' : days > 1 ? 'medium' : 'low';
  if (s.includes('Chp 1')) return days > 14 ? 'high' : days > 7 ? 'medium' : 'low';
  if (s.includes('10k') || s.includes('50k')) return days > 30 ? 'high' : days > 14 ? 'medium' : 'low';
  if (s.includes('Moderation') || s.includes('Mod Failed') || s.includes('Mod Passed')) return days > 14 ? 'high' : days > 7 ? 'medium' : 'low';
  if (s.includes('BES') || s.includes('WC <10k')) return days > 3 ? 'high' : days > 1 ? 'medium' : 'low';
  if (s.includes('LLM')) return days > 7 ? 'high' : days > 3 ? 'medium' : 'low';
  if (s.includes('Addn Details') || s.includes('Review')) return days > 14 ? 'high' : days > 7 ? 'medium' : 'low';
  if (s.includes('Contracting') || s.includes('Program ID') || s.includes('Signing Pending') || s === 'OFW') return days > 21 ? 'high' : days > 10 ? 'medium' : 'low';
  if (s.includes('PPV Testing') || s.includes('Testing Results')) return days > 14 ? 'high' : days > 7 ? 'medium' : 'low';
  return days > 14 ? 'high' : days > 7 ? 'medium' : 'low';
}

function computeCreateMonth(createDate) {
  const dt = parseFlexibleDate(createDate);
  if (!dt) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[dt.getMonth()] + " '" + String(dt.getFullYear()).slice(-2);
}

// Matches the step order of the Stage decision table (Dead > PPV Failed > Flow A/B).
const STAGE_ORDER = [
  'Dead - Book Status =',
  'Dead - Show Status =',
  'Check - PPV Bad',
  'Check - PPV Average',
  'PPV Bad',
  'PPV Avg',
  'Awaiting Chp 1',
  'Awaiting 10k',
  'Awaiting Moderation',
  'Mod Failed',
  'Check BES <> 10',
  'Check Mod Passed Pub WC <10k',
  'Send For 1 Hr LLM Score',
  'Awaiting 1 Hr LLM',
  'Check - 1 Hr LLM Failed',
  'Send Addn Details Form',
  'Awaiting Addn Details',
  'Send For Review',
  'Awaiting Review',
  'Send for Contracting',
  'Awaiting Program ID',
  'Signing Pending',
  'OFW',
  'WBP Ongoing',
  'Contract Rejected',
  'Awaiting 50k',
  'Awaiting 5 hr LLM',
  '5 Hr LLM Rejected',
  'Send for PPV Testing',
  'Awaiting Testing Results',
  'Mod Passed',
];

module.exports = { isBlankish, inList, daysAgo, parseFlexibleDate, computeBookStage, computeBookUrg, computeCreateMonth, STAGE_ORDER };
