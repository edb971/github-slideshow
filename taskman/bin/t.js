#!/usr/bin/env node
'use strict';
// Capture and glance at tasks from any terminal. Talks to the SQLite file directly,
// so it works whether or not the web server is running.
const cfg = require('../src/config');
const { openDb } = require('../src/db');
const store = require('../src/tasks');
const { today, formatDue, formatDay } = require('../src/dates');

const USAGE = `usage: t <command>

  t add "call Sam tomorrow 4pm #home p2"   add a task (quotes optional)
  t today                                  overdue + today (also: t ls)
  t upcoming                               next 7 days
  t done <id>                              complete a task
  t search <words>                         search open tasks
  t backup <file>                          consistent copy of the database
  t notify-test                            send a test push via ntfy
  t where                                  print the database path`;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = color('31'), dim = color('2'), bold = color('1');
const PRI = { 1: color('31')('p1'), 2: color('33')('p2'), 3: color('34')('p3'), 4: '  ' };

function line(t, todayStr) {
  const due = t.due_date ? formatDue(t, todayStr) : '';
  const late = t.due_date && t.due_date < todayStr;
  const bits = [
    dim(String(t.id).padStart(4)), PRI[t.priority], t.title,
    due && (late ? red(due) : dim(due)),
    t.rrule && dim(`↻ ${t.recur_text || 'repeats'}`),
    t.project && dim(`#${t.project}`),
  ];
  return bits.filter(Boolean).join('  ');
}

function describe(t, todayStr) {
  return [t.due_date && formatDue(t, todayStr), t.recur_text && `↻ ${t.recur_text}`,
    t.project && `#${t.project}`, t.priority < 4 && `p${t.priority}`].filter(Boolean).join(' · ') || 'no date';
}

async function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') return console.log(USAGE);
  if (cmd === 'where') return console.log(cfg.dbPath);

  const db = openDb(cfg.dbPath);
  const todayStr = today();
  try {
    switch (cmd) {
      case 'add':
      case 'a': {
        const t = store.quickAdd(db, args.join(' '));
        console.log(`Added ${bold(t.title)} ${dim(`[${t.id}]`)} · ${describe(t, todayStr)}`);
        break;
      }
      case 'today':
      case 'ls': {
        const { overdue, today: due } = store.todayView(db);
        if (overdue.length) { console.log(red(bold('Overdue'))); overdue.forEach((t) => console.log(line(t, todayStr))); }
        if (due.length) { console.log(bold('Today')); due.forEach((t) => console.log(line(t, todayStr))); }
        if (!overdue.length && !due.length) console.log(dim('Nothing due today.'));
        break;
      }
      case 'upcoming':
      case 'up': {
        const { overdue, days } = store.upcomingView(db);
        if (overdue.length) { console.log(red(bold('Overdue'))); overdue.forEach((t) => console.log(line(t, todayStr))); }
        for (const d of days) {
          if (!d.tasks.length) continue;
          console.log(bold(`${formatDay(d.date, todayStr)} ${dim(d.date)}`));
          d.tasks.forEach((t) => console.log(line(t, todayStr)));
        }
        break;
      }
      case 'done':
      case 'x': {
        if (!args.length) throw new store.ValidationError('usage: t done <id> [<id>...]');
        for (const id of args) {
          const r = store.completeTask(db, Number(id));
          if (!r) { console.error(`No open task ${id}`); process.exitCode = 1; continue; }
          console.log(`Completed ${bold(r.task.title)}${r.nextDue ? dim(` · next ${formatDue(r.task, todayStr)}`) : ''}`);
        }
        break;
      }
      case 'search':
      case 's': {
        const { open } = store.search(db, args.join(' '));
        if (!open.length) console.log(dim('No matches.'));
        open.forEach((t) => console.log(line(t, todayStr)));
        break;
      }
      case 'backup': {
        if (!args[0]) throw new store.ValidationError('usage: t backup <file>');
        await db.backup(args[0]);
        console.log(`Backed up ${cfg.dbPath} -> ${args[0]}`);
        break;
      }
      case 'notify-test': {
        if (!cfg.ntfy.topic) throw new store.ValidationError('NTFY_TOPIC is not set in .env');
        await require('../src/notify').sendNtfy(cfg.ntfy, { title: 'taskman', message: 'Test push: notifications work.', tags: ['white_check_mark'] });
        console.log(`Sent to ${cfg.ntfy.server}/${cfg.ntfy.topic}`);
        break;
      }
      default:
        console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
        process.exitCode = 2;
    }
  } finally {
    db.close();
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof store.ValidationError ? e.message : e);
  process.exitCode = 1;
});
