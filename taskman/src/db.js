'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    project      TEXT,
    priority     INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
    due_date     TEXT,          -- local 'YYYY-MM-DD'
    due_time     TEXT,          -- local 'HH:MM'
    rrule        TEXT,          -- 'RRULE:FREQ=...' when recurring
    recur_text   TEXT,          -- what the user typed, e.g. 'every mon,thu'
    completed_at TEXT,
    reminded_for TEXT,          -- 'YYYY-MM-DD HH:MM' of the due moment last pushed
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX tasks_open_due ON tasks (completed_at, due_date);
  CREATE INDEX tasks_project ON tasks (project);

  -- One row per completion. For recurring tasks this is the history, and it
  -- holds the previous due date so a completion can be undone.
  CREATE TABLE completions (
    id           INTEGER PRIMARY KEY,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL,
    due_date     TEXT,
    due_time     TEXT,
    reminded_for TEXT
  );
  CREATE INDEX completions_task ON completions (task_id);

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `,
];

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // lets the CLI write while the server is running
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.pragma('user_version', { simple: true });
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

module.exports = { openDb };
