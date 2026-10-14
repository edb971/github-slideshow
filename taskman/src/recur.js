'use strict';
// Recurrence: tasks store an RFC 5545 RRULE string (e.g. 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH').
// The rule is anchored on the task's current due date, which is always an occurrence,
// so INTERVAL rules ("every 2 weeks") stay in phase as the task rolls forward.
const { RRule } = require('rrule');
const { dateStrToUTC, utcToDateStr } = require('./dates');

function buildRule(rruleStr, anchorDateStr) {
  const opts = RRule.parseString(String(rruleStr).trim().replace(/^RRULE:/i, ''));
  // Tasks recur by date; the time of day lives in due_time.
  delete opts.byhour;
  delete opts.byminute;
  delete opts.bysecond;
  delete opts.dtstart;
  return new RRule({ ...opts, dtstart: dateStrToUTC(anchorDateStr) });
}

// Throws on anything rrule cannot parse; returns the canonical 'RRULE:...' form.
function normalizeRule(rruleStr) {
  const s = String(rruleStr).trim().replace(/^RRULE:/i, '');
  if (!/FREQ=/i.test(s)) throw new Error(`Not an RRULE: ${rruleStr}`);
  const opts = RRule.parseString(s);
  if (opts.freq === undefined) throw new Error(`Not an RRULE: ${rruleStr}`);
  delete opts.byhour;
  delete opts.byminute;
  delete opts.bysecond;
  delete opts.dtstart;
  const out = RRule.optionsToString(opts);
  return out.startsWith('RRULE:') ? out : `RRULE:${out}`;
}

// First occurrence strictly after `afterDateStr`, or null if the rule has ended.
function nextAfter(rruleStr, anchorDateStr, afterDateStr) {
  const n = buildRule(rruleStr, anchorDateStr).after(dateStrToUTC(afterDateStr), false);
  return n ? utcToDateStr(n) : null;
}

// First occurrence on or after `fromDateStr` (used when a recurring task has no date yet).
function firstOnOrAfter(rruleStr, fromDateStr) {
  const n = buildRule(rruleStr, fromDateStr).after(dateStrToUTC(fromDateStr), true);
  return n ? utcToDateStr(n) : null;
}

// Occurrences within [startDateStr, endDateStr], inclusive.
function between(rruleStr, anchorDateStr, startDateStr, endDateStr) {
  return buildRule(rruleStr, anchorDateStr)
    .between(dateStrToUTC(startDateStr), dateStrToUTC(endDateStr), true)
    .map(utcToDateStr);
}

module.exports = { normalizeRule, nextAfter, firstOnOrAfter, between };
