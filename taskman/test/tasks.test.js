'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const store = require('../src/tasks');

const at = (d, h = 10, m = 0) => { const [y, mo, da] = d.split('-').map(Number); return new Date(y, mo - 1, da, h, m); };
const NOW = at('2026-10-14'); // a Wednesday

test('completing a one-off task, then undoing it', () => {
  const db = openDb(':memory:');
  const t = store.quickAdd(db, 'call Sam tomorrow 4pm #home p2', { now: NOW });
  const r = store.completeTask(db, t.id, NOW);
  assert.equal(r.nextDue, null);
  assert.ok(r.task.completed_at);
  assert.equal(store.completeTask(db, t.id, NOW), null, 'cannot complete twice');
  const back = store.undoCompletion(db, r.completionId, NOW);
  assert.equal(back.completed_at, null);
  assert.equal(back.due_date, '2026-10-15');
});

test('completing a recurring task schedules the next occurrence', () => {
  const db = openDb(':memory:');
  const t = store.quickAdd(db, 'gym every mon,thu 7am', { now: NOW });
  assert.equal(t.due_date, '2026-10-15');
  let r = store.completeTask(db, t.id, NOW);
  assert.equal(r.nextDue, '2026-10-19');
  assert.equal(r.task.completed_at, null);
  assert.equal(r.task.due_time, '07:00');
  r = store.completeTask(db, t.id, NOW);
  assert.equal(r.nextDue, '2026-10-22');
  assert.equal(store.completionsFor(db, t.id).length, 2);
  store.undoCompletion(db, r.completionId, NOW);
  assert.equal(store.getTask(db, t.id).due_date, '2026-10-19');
});

test('an overdue recurring task rolls forward past today, not to another past date', () => {
  const db = openDb(':memory:');
  const t = store.quickAdd(db, 'water plants daily', { now: at('2026-10-01') });
  assert.equal(t.due_date, '2026-10-01');
  const r = store.completeTask(db, t.id, NOW);
  assert.equal(r.nextDue, '2026-10-15');
});

test('"every 1st" keeps landing on the 1st', () => {
  const db = openDb(':memory:');
  const t = store.quickAdd(db, 'pay rent every 1st #home p1', { now: NOW });
  assert.equal(store.completeTask(db, t.id, at('2026-11-01')).nextDue, '2026-12-01');
  assert.equal(store.completeTask(db, t.id, at('2026-12-01')).nextDue, '2027-01-01');
});

test('Today view pins overdue tasks separately', () => {
  const db = openDb(':memory:');
  store.createTask(db, { title: 'late', due_date: '2026-10-10' }, NOW);
  store.createTask(db, { title: 'now p1', due_date: '2026-10-14', priority: 1 }, NOW);
  store.createTask(db, { title: 'now p3', due_date: '2026-10-14', priority: 3 }, NOW);
  store.createTask(db, { title: 'later', due_date: '2026-10-20' }, NOW);
  store.createTask(db, { title: 'someday' }, NOW);
  const v = store.todayView(db, NOW);
  assert.deepEqual(v.overdue.map((t) => t.title), ['late']);
  assert.deepEqual(v.today.map((t) => t.title), ['now p1', 'now p3']);
  assert.deepEqual(store.counts(db, NOW), { today: 3, inbox: 5, overdue: 1 });
});

test('Upcoming groups 7 days and expands recurring occurrences', () => {
  const db = openDb(':memory:');
  store.quickAdd(db, 'gym every mon,thu', { now: NOW });
  store.createTask(db, { title: 'dentist', due_date: '2026-10-16', due_time: '09:30' }, NOW);
  store.createTask(db, { title: 'too far', due_date: '2026-10-21' }, NOW);
  const { days } = store.upcomingView(db, NOW);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-10-14');
  assert.equal(days[6].date, '2026-10-20');
  const byDate = Object.fromEntries(days.map((d) => [d.date, d.tasks.map((t) => t.title + (t.virtual ? '*' : ''))]));
  assert.deepEqual(byDate['2026-10-15'], ['gym']);
  assert.deepEqual(byDate['2026-10-16'], ['dentist']);
  assert.deepEqual(byDate['2026-10-19'], ['gym*']);
  assert.ok(!Object.values(byDate).flat().includes('too far'));
});

test('editing: repeat text, project cleanup, validation', () => {
  const db = openDb(':memory:');
  const t = store.createTask(db, { title: 'x' }, NOW);
  const u = store.updateTask(db, t.id, { recurrence: 'every fri', project: '#Side Project', notes: 'a\r\nb' }, NOW);
  assert.equal(u.rrule, 'RRULE:FREQ=WEEKLY;BYDAY=FR');
  assert.equal(u.due_date, '2026-10-16');
  assert.equal(u.project, 'side-project');
  assert.equal(u.notes, 'a\nb');
  assert.throws(() => store.updateTask(db, t.id, { recurrence: 'sometimes' }, NOW), store.ValidationError);
  assert.throws(() => store.updateTask(db, t.id, { due_date: '2026-02-30' }, NOW), store.ValidationError);
  assert.equal(store.updateTask(db, t.id, { recurrence: '' }, NOW).rrule, null);
});

test('search matches title, notes and project; LIKE wildcards are literal', () => {
  const db = openDb(':memory:');
  store.createTask(db, { title: 'renew passport', notes: 'photo booth', project: 'admin' }, NOW);
  store.createTask(db, { title: '100% done' }, NOW);
  assert.equal(store.search(db, 'booth').open.length, 1);
  assert.equal(store.search(db, 'admin').open.length, 1);
  assert.equal(store.search(db, '%').open.length, 1);
});
