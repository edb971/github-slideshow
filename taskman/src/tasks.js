'use strict';
// All task reads and writes. Shared by the web server, the scheduler and the CLI.
const { today, addDays, isDateStr, isTimeStr, dueMoment } = require('./dates');
const recur = require('./recur');
const { parseQuickAdd, parseRecurrence } = require('./parse');

const ORDER = 'priority, due_time IS NULL, due_time, id';
const OPEN = 'completed_at IS NULL';

class ValidationError extends Error {}

function cleanProject(p) {
  if (p == null) return null;
  const s = String(p).trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
  if (!s) return null;
  if (!/^[\p{L}\p{N}_-]+$/u.test(s)) throw new ValidationError(`Bad project name: ${p}`);
  return s;
}

// Validates a partial task. Unknown keys are ignored.
function clean(fields) {
  const out = {};
  if ('title' in fields) {
    out.title = String(fields.title || '').trim();
    if (!out.title) throw new ValidationError('Title is required');
  }
  if ('notes' in fields) out.notes = String(fields.notes || '').replace(/\r\n/g, '\n').trimEnd();
  if ('project' in fields) out.project = cleanProject(fields.project);
  if ('priority' in fields) {
    out.priority = Number(fields.priority) || 4;
    if (![1, 2, 3, 4].includes(out.priority)) throw new ValidationError('Priority must be 1-4');
  }
  if ('due_date' in fields) {
    out.due_date = fields.due_date || null;
    if (out.due_date && !isDateStr(out.due_date)) throw new ValidationError(`Bad date: ${out.due_date}`);
  }
  if ('due_time' in fields) {
    out.due_time = fields.due_time || null;
    if (out.due_time && !isTimeStr(out.due_time)) throw new ValidationError(`Bad time: ${out.due_time}`);
  }
  if ('rrule' in fields) out.rrule = fields.rrule || null;
  if ('recur_text' in fields) out.recur_text = fields.recur_text || null;
  return out;
}

// A time needs a date, and a recurring task needs a date that is an occurrence.
function settleDue(t, now) {
  if (t.due_time && !t.due_date) t.due_date = today(now);
  if (t.rrule) {
    t.due_date = recur.firstOnOrAfter(t.rrule, t.due_date || today(now));
    if (!t.due_date) throw new ValidationError('That repeat rule has no future occurrences');
  }
  return t;
}

function createTask(db, fields, now = new Date()) {
  const t = settleDue({
    notes: '', project: null, priority: 4, due_date: null, due_time: null, rrule: null, recur_text: null,
    ...clean(fields),
  }, now);
  if (!t.title) throw new ValidationError('Title is required');
  const stamp = now.toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO tasks (title, notes, project, priority, due_date, due_time, rrule, recur_text, created_at, updated_at)
    VALUES (@title, @notes, @project, @priority, @due_date, @due_time, @rrule, @recur_text, @stamp, @stamp)
  `).run({ ...t, stamp });
  return getTask(db, lastInsertRowid);
}

// `defaults` fills in what the text didn't say, e.g. the project of the page you're on.
function quickAdd(db, text, { now = new Date(), defaults = {} } = {}) {
  if (!String(text || '').trim()) throw new ValidationError('Nothing to add');
  const p = parseQuickAdd(text, now);
  if (!p.project && defaults.project) p.project = defaults.project;
  if (!p.due_date && defaults.due_date) p.due_date = defaults.due_date;
  return createTask(db, p, now);
}

const getTask = (db, id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) || null;

// `fields.recurrence` is the free-text repeat field from the edit form.
function updateTask(db, id, fields, now = new Date()) {
  const cur = getTask(db, id);
  if (!cur) return null;
  const patch = clean(fields);
  if ('recurrence' in fields) {
    let r;
    try { r = parseRecurrence(fields.recurrence); } catch (e) { throw new ValidationError(e.message); }
    patch.rrule = r ? r.rrule : null;
    patch.recur_text = r ? r.text : null;
  }
  const next = settleDue({ ...cur, ...patch }, now);
  if (next.due_date !== cur.due_date || next.due_time !== cur.due_time) next.reminded_for = null;
  db.prepare(`
    UPDATE tasks SET title=@title, notes=@notes, project=@project, priority=@priority,
      due_date=@due_date, due_time=@due_time, rrule=@rrule, recur_text=@recur_text,
      reminded_for=@reminded_for, updated_at=@stamp
    WHERE id=@id
  `).run({ ...next, stamp: now.toISOString() });
  return getTask(db, id);
}

const deleteTask = (db, id) => db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;

// Completing a recurring task logs the completion and rolls the due date to the
// next occurrence after both the current due date and today, so finishing an
// overdue daily task doesn't leave a backlog of past copies.
// Returns { completionId, task, nextDue } (nextDue null when the task is done for good).
function completeTask(db, id, now = new Date()) {
  return db.transaction(() => {
    const t = getTask(db, id);
    if (!t || t.completed_at) return null;
    const stamp = now.toISOString();
    const { lastInsertRowid: completionId } = db.prepare(`
      INSERT INTO completions (task_id, completed_at, due_date, due_time, reminded_for)
      VALUES (?, ?, ?, ?, ?)
    `).run(t.id, stamp, t.due_date, t.due_time, t.reminded_for);

    let nextDue = null;
    if (t.rrule) {
      const todayStr = today(now);
      const anchor = t.due_date || todayStr;
      nextDue = recur.nextAfter(t.rrule, anchor, anchor > todayStr ? anchor : todayStr);
    }
    if (nextDue) {
      db.prepare('UPDATE tasks SET due_date=?, reminded_for=NULL, updated_at=? WHERE id=?')
        .run(nextDue, stamp, t.id);
    } else {
      db.prepare('UPDATE tasks SET completed_at=?, updated_at=? WHERE id=?').run(stamp, stamp, t.id);
    }
    return { completionId: Number(completionId), task: getTask(db, t.id), nextDue };
  })();
}

function undoCompletion(db, completionId, now = new Date()) {
  return db.transaction(() => {
    const c = db.prepare('SELECT * FROM completions WHERE id = ?').get(completionId);
    if (!c) return null;
    db.prepare(`
      UPDATE tasks SET completed_at=NULL, due_date=?, due_time=?, reminded_for=?, updated_at=? WHERE id=?
    `).run(c.due_date, c.due_time, c.reminded_for, now.toISOString(), c.task_id);
    db.prepare('DELETE FROM completions WHERE id = ?').run(c.id);
    return getTask(db, c.task_id);
  })();
}

function todayView(db, now = new Date()) {
  const t = today(now);
  return {
    overdue: db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND due_date < ? ORDER BY due_date, ${ORDER}`).all(t),
    today: db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND due_date = ? ORDER BY ${ORDER}`).all(t),
  };
}

// Overdue plus the next `days` days (today included), grouped by day. Recurring tasks
// also show their later occurrences in the window, flagged `virtual`.
function upcomingView(db, now = new Date(), days = 7) {
  const start = today(now);
  const end = addDays(start, days - 1);
  const groups = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) groups.set(d, []);

  const rows = db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND due_date BETWEEN ? AND ? ORDER BY ${ORDER}`)
    .all(start, end);
  for (const r of rows) groups.get(r.due_date).push(r);

  const recurring = db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND rrule IS NOT NULL AND due_date <= ?`).all(end);
  for (const r of recurring) {
    const from = r.due_date >= start ? addDays(r.due_date, 1) : addDays(start, 1);
    if (from > end) continue;
    for (const d of recur.between(r.rrule, r.due_date, from, end)) {
      groups.get(d).push({ ...r, due_date: d, virtual: true });
    }
  }
  const byOrder = (a, b) => a.priority - b.priority
    || (a.due_time || '99').localeCompare(b.due_time || '99') || a.id - b.id;

  return {
    overdue: db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND due_date < ? ORDER BY due_date, ${ORDER}`).all(start),
    days: [...groups].map(([date, tasks]) => ({ date, tasks: tasks.sort(byOrder) })),
  };
}

const BY_DUE = `due_date IS NULL, due_date, ${ORDER}`;

const projectTasks = (db, name) =>
  db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND project = ? ORDER BY ${BY_DUE}`).all(cleanProject(name));

const inboxTasks = (db) =>
  db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND project IS NULL ORDER BY ${BY_DUE}`).all();

function search(db, q) {
  const like = `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = `(title LIKE @like ESCAPE '\\' OR notes LIKE @like ESCAPE '\\' OR project LIKE @like ESCAPE '\\')`;
  return {
    open: db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND ${where} ORDER BY ${BY_DUE}`).all({ like }),
    done: db.prepare(`SELECT * FROM tasks WHERE completed_at IS NOT NULL AND ${where}
                      ORDER BY completed_at DESC LIMIT 25`).all({ like }),
  };
}

const projects = (db) => db.prepare(`
  SELECT project AS name, COUNT(*) AS count FROM tasks
  WHERE ${OPEN} AND project IS NOT NULL GROUP BY project ORDER BY project
`).all();

function counts(db, now = new Date()) {
  return db.prepare(`
    SELECT SUM(due_date <= @t) AS today, SUM(project IS NULL) AS inbox,
           SUM(due_date < @t) AS overdue
    FROM tasks WHERE ${OPEN}
  `).get({ t: today(now) });
}

const recentCompletions = (db, limit = 50) => db.prepare(`
  SELECT c.id AS completion_id, c.completed_at AS done_at, c.due_date AS done_due, t.*
  FROM completions c JOIN tasks t ON t.id = c.task_id
  ORDER BY c.completed_at DESC, c.id DESC LIMIT ?
`).all(limit);

const completionsFor = (db, taskId, limit = 20) => db.prepare(`
  SELECT * FROM completions WHERE task_id = ? ORDER BY completed_at DESC, id DESC LIMIT ?
`).all(taskId, limit);

const reminderKey = (t) => `${t.due_date} ${t.due_time}`;

// Timed tasks whose reminder moment has arrived and that haven't been pushed yet.
// Anything more than an hour past due is skipped (and marked) so a restart after
// downtime doesn't flood the phone with stale reminders.
function dueReminders(db, now = new Date(), leadMinutes = 0) {
  const t = today(now);
  const rows = db.prepare(`
    SELECT * FROM tasks WHERE ${OPEN} AND due_time IS NOT NULL AND due_date BETWEEN ? AND ?
      AND (reminded_for IS NULL OR reminded_for != due_date || ' ' || due_time)
  `).all(addDays(t, -1), addDays(t, 1));
  const due = [];
  for (const r of rows) {
    const at = dueMoment(r.due_date, r.due_time).getTime();
    if (now.getTime() < at - leadMinutes * 60_000) continue;
    if (now.getTime() > at + 60 * 60_000) markReminded(db, r);
    else due.push(r);
  }
  return due;
}

function markReminded(db, task) {
  db.prepare('UPDATE tasks SET reminded_for = ? WHERE id = ?').run(reminderKey(task), task.id);
}

const getMeta = (db, key) => db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(key) ?? null;
const setMeta = (db, key, value) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);

module.exports = {
  ValidationError, createTask, quickAdd, getTask, updateTask, deleteTask, completeTask, undoCompletion,
  todayView, upcomingView, projectTasks, inboxTasks, search, projects, counts,
  recentCompletions, completionsFor, dueReminders, markReminded, getMeta, setMeta, cleanProject,
};
