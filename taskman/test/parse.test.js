'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuickAdd, parseRecurrence } = require('../src/parse');

// Wednesday 14 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 14, 10, 0);
const p = (s) => parseQuickAdd(s, NOW);

test('the headline example: date, time, project and priority in one line', () => {
  assert.deepEqual(p('call Sam tomorrow 4pm #home p2'), {
    title: 'call Sam', project: 'home', priority: 2,
    due_date: '2026-10-15', due_time: '16:00', rrule: null, recur_text: null,
  });
});

test('plain text stays a plain task', () => {
  const t = p('buy 2 apples');
  assert.equal(t.title, 'buy 2 apples');
  assert.equal(t.due_date, null);
  assert.equal(t.priority, 4);
});

test('dangling "by"/"on" before a date is dropped from the title', () => {
  assert.equal(p('taxes by oct 31').title, 'taxes');
  assert.equal(p('taxes by oct 31').due_date, '2026-10-31');
  assert.equal(p('pay rent on friday').title, 'pay rent');
});

test('quoted text is never parsed', () => {
  const t = p('watch "Friday Night Lights" #tv');
  assert.equal(t.title, 'watch Friday Night Lights');
  assert.equal(t.due_date, null);
  assert.equal(t.project, 'tv');
});

test('recurrence phrases become RRULEs with the first occurrence as due date', () => {
  const cases = [
    ['pay rent every 1st', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1', '2026-11-01'],
    ['gym every mon,thu', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', '2026-10-15'],
    ['bins every mon and thu', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', '2026-10-15'],
    ['standup every weekday', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-14'],
    ['water plants every other day', 'RRULE:FREQ=DAILY;INTERVAL=2', '2026-10-14'],
    ['backup every 2 weeks', 'RRULE:FREQ=WEEKLY;INTERVAL=2', '2026-10-14'],
    ['invoice every last day', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', '2026-10-31'],
    ['journal daily', 'RRULE:FREQ=DAILY', '2026-10-14'],
  ];
  for (const [input, rrule, due] of cases) {
    const t = p(input);
    assert.equal(t.rrule, rrule, input);
    assert.equal(t.due_date, due, input);
    assert.ok(!/every|daily/.test(t.title), `title "${t.title}" for ${input}`);
  }
});

test('recurrence with a time that has already passed today starts tomorrow', () => {
  const t = p('read every day at 8am');
  assert.equal(t.due_date, '2026-10-15');
  assert.equal(t.due_time, '08:00');
  assert.equal(p('read every day at 11am').due_date, '2026-10-14');
});

test('"every" in ordinary prose is left alone', () => {
  assert.equal(p('every time I see it').rrule, null);
  assert.equal(p('weekly review').title, 'weekly review');
  assert.equal(p('weekly review').rrule, null);
});

test('parseRecurrence accepts phrases and raw RRULEs, rejects junk', () => {
  assert.equal(parseRecurrence('every mon,thu').rrule, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH');
  assert.equal(parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=15').rrule, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15');
  assert.equal(parseRecurrence(''), null);
  assert.throws(() => parseRecurrence('whenever I feel like it'));
});
