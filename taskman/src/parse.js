'use strict';
// Quick-add parser: "call Sam tomorrow 4pm #home p2 every mon"
//   -> { title, project, priority, due_date, due_time, rrule, recur_text }
// Text inside "double quotes" is never parsed, so `"Friday" review` stays literal.
const chrono = require('chrono-node');
const { toDateStr, toTimeStr, today, addDays } = require('./dates');
const { normalizeRule, firstOnOrAfter } = require('./recur');

const DAY_CODES = {
  mon: 'MO', monday: 'MO', mondays: 'MO',
  tue: 'TU', tues: 'TU', tuesday: 'TU', tuesdays: 'TU',
  wed: 'WE', weds: 'WE', wednesday: 'WE', wednesdays: 'WE',
  thu: 'TH', thur: 'TH', thurs: 'TH', thursday: 'TH', thursdays: 'TH',
  fri: 'FR', friday: 'FR', fridays: 'FR',
  sat: 'SA', saturday: 'SA', saturdays: 'SA',
  sun: 'SU', sunday: 'SU', sundays: 'SU',
};
const UNITS = {
  day: 'DAILY', days: 'DAILY', week: 'WEEKLY', weeks: 'WEEKLY',
  month: 'MONTHLY', months: 'MONTHLY', year: 'YEARLY', years: 'YEARLY',
};
const SHORTHAND = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY', annually: 'YEARLY' };

// Interpret the words of a recurrence phrase. `words` excludes the leading "every".
// Returns { rrule, used } where `used` is how many words belonged to the phrase,
// or null if the words don't describe a schedule.
function recurrenceFromWords(words) {
  let interval = 1;
  let freq = null;
  const byday = [];
  const bymonthday = [];
  let used = 0;
  let committed = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    let m;
    if (w === 'and' || w === ',') { used = i + 1; continue; }
    if (w === 'other' && i === 0) { interval = 2; used = i + 1; continue; }
    if (/^\d+$/.test(w) && i === 0 && UNITS[(words[1] || '').toLowerCase()]) {
      interval = Number(w); used = i + 1; continue;
    }
    if (UNITS[w] && !freq && !byday.length && !bymonthday.length) { freq = UNITS[w]; }
    else if ((w === 'weekday' || w === 'weekdays') && !freq) { freq = 'WEEKLY'; byday.push('MO', 'TU', 'WE', 'TH', 'FR'); }
    else if ((w === 'weekend' || w === 'weekends') && !freq) { freq = 'WEEKLY'; byday.push('SA', 'SU'); }
    else if (DAY_CODES[w] && !freq && !bymonthday.length) { byday.push(DAY_CODES[w]); }
    else if ((m = w.match(/^(\d{1,2})(st|nd|rd|th)$/)) && Number(m[1]) >= 1 && Number(m[1]) <= 31
      && !freq && !byday.length) { bymonthday.push(Number(m[1])); }
    else if (w === 'last' && /^days?$/i.test(words[i + 1] || '') && !freq && !byday.length) {
      bymonthday.push(-1); i++;
    } else break;
    used = i + 1;
    committed = used;
  }
  if (!committed) return null;

  let rule;
  if (bymonthday.length) rule = `FREQ=MONTHLY;BYMONTHDAY=${[...new Set(bymonthday)].join(',')}`;
  else if (byday.length) rule = `FREQ=WEEKLY;BYDAY=${[...new Set(byday)].join(',')}`;
  else rule = `FREQ=${freq}`;
  if (interval > 1) rule += `;INTERVAL=${interval}`;
  return { rrule: normalizeRule(rule), used: committed };
}

const WORD_RE = /,|[A-Za-z0-9]+/g;

// Finds "every ..." / "daily" etc. in text. Returns { rrule, text, start, end } or null.
function findRecurrence(text) {
  // Shorthands only count after the first word, so "weekly review" stays a title.
  const short = text.match(/\S\s+(daily|weekly|monthly|yearly|annually)(?=\s|$)/i);
  const every = /(?:^|\s)(every)\s+/gi;
  let m;
  while ((m = every.exec(text))) {
    const start = m.index + m[0].indexOf(m[1]);
    const rest = text.slice(every.lastIndex);
    const tokens = [...rest.matchAll(WORD_RE)];
    const r = recurrenceFromWords(tokens.map((t) => t[0]));
    if (r) {
      const last = tokens[r.used - 1];
      const end = every.lastIndex + last.index + last[0].length;
      return { rrule: r.rrule, text: text.slice(start, end), start, end };
    }
  }
  if (short) {
    const start = short.index + short[0].indexOf(short[1]);
    return {
      rrule: normalizeRule(`FREQ=${SHORTHAND[short[1].toLowerCase()]}`),
      text: short[1], start, end: start + short[1].length,
    };
  }
  return null;
}

// Parses a recurrence field from the edit form: "every mon,thu" or a raw RRULE.
function parseRecurrence(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/FREQ=/i.test(s)) return { rrule: normalizeRule(s), text: null };
  const found = findRecurrence(s);
  if (!found || s.replace(found.text, '').trim()) {
    throw new Error(`Couldn't understand repeat "${s}". Try "every mon,thu", "every 1st", or an RRULE.`);
  }
  return { rrule: found.rrule, text: found.text };
}

const cut = (s, start, end) => `${s.slice(0, start)} ${s.slice(end)}`;

function parseQuickAdd(input, now = new Date()) {
  const quoted = [];
  let text = String(input).replace(/"([^"]*)"/g, (_, q) => {
    quoted.push(q);
    return `⁠Q${quoted.length - 1}⁠`;
  });

  const out = {
    title: '', project: null, priority: 4,
    due_date: null, due_time: null, rrule: null, recur_text: null,
  };

  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (all, sp, tag) => {
    if (!out.project) out.project = tag.toLowerCase();
    return sp;
  });

  text = text.replace(/(^|\s)[pP]([1-4])(?=\s|$)/g, (all, sp, n) => {
    out.priority = Number(n);
    return sp;
  });

  const rec = findRecurrence(text);
  if (rec) {
    out.rrule = rec.rrule;
    out.recur_text = rec.text.toLowerCase();
    text = cut(text, rec.start, rec.end);
  }

  const [hit] = chrono.parse(text, now, { forwardDate: true });
  let explicitDate = false;
  if (hit) {
    const when = hit.start.date();
    // A bare time ("9am") implies no date; anything else ("fri", "tonight") names one.
    explicitDate = !hit.start.isCertain('hour')
      || ['day', 'weekday', 'month'].some((c) => hit.start.isCertain(c));
    if (hit.start.isCertain('hour')) out.due_time = toTimeStr(when);
    out.due_date = toDateStr(when);
    // Drop a dangling "by"/"due"/"on"/"at" that chrono left in front of the date.
    const before = text.slice(0, hit.index).replace(/\s(by|due|on|at)\s*$/i, ' ');
    text = `${before} ${text.slice(hit.index + hit.text.length)}`;
  }

  if (out.rrule) {
    // "every mon 9am": the date comes from the rule; "every mon starting nov 3": from chrono.
    let from = explicitDate && out.due_date ? out.due_date : today(now);
    if (!explicitDate && out.due_time && out.due_time <= toTimeStr(now)) from = addDays(from, 1);
    out.due_date = firstOnOrAfter(out.rrule, from);
    if (!out.due_date) { out.rrule = null; out.recur_text = null; }
  }

  out.title = text
    .replace(/⁠Q(\d+)⁠/g, (_, i) => quoted[Number(i)])
    .replace(/\s+/g, ' ')
    .trim();
  if (!out.title) out.title = String(input).trim();
  return out;
}

module.exports = { parseQuickAdd, parseRecurrence, findRecurrence };
