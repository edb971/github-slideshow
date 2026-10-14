'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const store = require('../src/tasks');
const { tick } = require('../src/notify');

const at = (h, m, d = 14) => new Date(2026, 9, d, h, m);
const cfg = { ntfy: { server: 'http://x', topic: 't' }, digestTime: '07:00', remindBeforeMinutes: 0 };
const quiet = { error() {}, log() {} };

function recorder() {
  const sent = [];
  const send = async (_ntfy, msg) => { sent.push(msg); };
  return { sent, send };
}

test('timed task is pushed once, when due', async () => {
  const db = openDb(':memory:');
  store.createTask(db, { title: 'call Sam', due_date: '2026-10-14', due_time: '16:00', priority: 2 }, at(9, 0));
  const { sent, send } = recorder();
  const c = { ...cfg, digestTime: '' };
  await tick(db, c, at(15, 59), send, quiet);
  assert.equal(sent.length, 0);
  await tick(db, c, at(16, 0), send, quiet);
  await tick(db, c, at(16, 1), send, quiet);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'call Sam');
  assert.equal(sent[0].priority, 4);
});

test('a failed push is retried next minute', async () => {
  const db = openDb(':memory:');
  store.createTask(db, { title: 'x', due_date: '2026-10-14', due_time: '16:00' }, at(9, 0));
  let calls = 0;
  const flaky = async () => { calls++; if (calls === 1) throw new Error('offline'); };
  await tick(db, { ...cfg, digestTime: '' }, at(16, 0), flaky, quiet);
  await tick(db, { ...cfg, digestTime: '' }, at(16, 1), flaky, quiet);
  await tick(db, { ...cfg, digestTime: '' }, at(16, 2), flaky, quiet);
  assert.equal(calls, 2);
});

test('stale reminders (over an hour late) are skipped, and lead time works', async () => {
  const db = openDb(':memory:');
  store.createTask(db, { title: 'old', due_date: '2026-10-14', due_time: '08:00' }, at(7, 0));
  store.createTask(db, { title: 'soon', due_date: '2026-10-14', due_time: '12:10' }, at(7, 0));
  const { sent, send } = recorder();
  await tick(db, { ...cfg, digestTime: '', remindBeforeMinutes: 15 }, at(11, 55), send, quiet);
  assert.deepEqual(sent.map((s) => s.title), ['soon']);
});

test('completing a recurring task re-arms its reminder for the next occurrence', async () => {
  const db = openDb(':memory:');
  const t = store.quickAdd(db, 'standup every weekday 9am', { now: at(8, 0) });
  const { sent, send } = recorder();
  const c = { ...cfg, digestTime: '' };
  await tick(db, c, at(9, 0), send, quiet);
  store.completeTask(db, t.id, at(9, 5));
  await tick(db, c, at(9, 0, 15), send, quiet);
  assert.equal(sent.length, 2);
});

test('digest goes out once at 7am, catching up if the machine was asleep', async () => {
  const db = openDb(':memory:');
  store.createTask(db, { title: 'late thing', due_date: '2026-10-12' }, at(6, 0));
  store.createTask(db, { title: 'today thing', due_date: '2026-10-14', priority: 1 }, at(6, 0));
  const { sent, send } = recorder();
  await tick(db, cfg, at(6, 59), send, quiet);
  assert.equal(sent.length, 0);
  await tick(db, cfg, at(8, 30), send, quiet);
  await tick(db, cfg, at(8, 31), send, quiet);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Today: 1 today, 1 overdue');
  assert.match(sent[0].message, /Overdue:\n• late thing/);
  assert.match(sent[0].message, /Today:\n• \[p1\] today thing/);
  await tick(db, cfg, at(7, 0, 15), send, quiet);
  assert.equal(sent.length, 2, 'next day sends again');
});
