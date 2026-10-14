'use strict';
// Push notifications via ntfy (https://ntfy.sh). Nothing else leaves the machine.
const cron = require('node-cron');
const store = require('./tasks');
const { today, toTimeStr, formatDue } = require('./dates');

const NTFY_PRIORITY = { 1: 5, 2: 4, 3: 3, 4: 3 }; // p1 -> urgent, p2 -> high, else default

// Uses ntfy's JSON publish API so titles can contain any Unicode.
async function sendNtfy(ntfy, { title, message, priority = 3, tags = [] }) {
  const res = await fetch(ntfy.server, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ntfy.token ? { Authorization: `Bearer ${ntfy.token}` } : {}),
    },
    body: JSON.stringify({ topic: ntfy.topic, title, message, priority, tags }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function taskLine(t, todayStr) {
  const bits = [t.title];
  if (t.due_time) bits.push(t.due_time);
  if (t.due_date && t.due_date < todayStr) bits.push(`(${formatDue(t, todayStr)})`);
  if (t.project) bits.push(`#${t.project}`);
  return `${t.priority < 4 ? `[p${t.priority}] ` : ''}${bits.join(' ')}`;
}

function digestMessage(db, now) {
  const t = today(now);
  const { overdue, today: due } = store.todayView(db, now);
  if (!overdue.length && !due.length) return { title: 'Today: nothing due', message: 'Clear day.' };
  const parts = [];
  if (overdue.length) parts.push(`Overdue:\n${overdue.map((x) => `• ${taskLine(x, t)}`).join('\n')}`);
  if (due.length) parts.push(`Today:\n${due.map((x) => `• ${taskLine(x, t)}`).join('\n')}`);
  const head = [due.length && `${due.length} today`, overdue.length && `${overdue.length} overdue`]
    .filter(Boolean).join(', ');
  return { title: `Today: ${head}`, message: parts.join('\n\n'), priority: overdue.length ? 4 : 3 };
}

// Runs once a minute. Sends reminders for timed tasks, then the morning digest.
// The digest catches up for up to 4 hours after DIGEST_TIME if the machine was
// asleep, and records the date it was sent so it only goes out once per day.
async function tick(db, cfg, now = new Date(), send = sendNtfy, log = console) {
  const todayStr = today(now);
  for (const t of store.dueReminders(db, now, cfg.remindBeforeMinutes)) {
    try {
      await send(cfg.ntfy, {
        title: t.title,
        message: [formatDue(t, todayStr), t.project && `#${t.project}`, t.notes && t.notes.slice(0, 200)]
          .filter(Boolean).join(' · '),
        priority: NTFY_PRIORITY[t.priority],
        tags: ['alarm_clock'],
      });
      store.markReminded(db, t);
    } catch (e) {
      log.error(`reminder for task ${t.id} failed (will retry): ${e.message}`);
    }
  }

  if (/^\d{2}:\d{2}$/.test(cfg.digestTime) && store.getMeta(db, 'last_digest') !== todayStr) {
    const nowHM = toTimeStr(now);
    const [h, m] = cfg.digestTime.split(':').map(Number);
    const endHM = `${String(Math.min(23, h + 4)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (nowHM >= cfg.digestTime && nowHM <= endHM) {
      try {
        await send(cfg.ntfy, { ...digestMessage(db, now), tags: ['sunrise'] });
        store.setMeta(db, 'last_digest', todayStr);
      } catch (e) {
        log.error(`digest failed (will retry): ${e.message}`);
      }
    }
  }
}

function startScheduler(db, cfg, log = console) {
  if (!cfg.ntfy.topic) {
    log.log('ntfy: NTFY_TOPIC is not set, reminders and digest are off');
    return null;
  }
  log.log(`ntfy: pushing to ${cfg.ntfy.server}/${cfg.ntfy.topic}` +
    (cfg.digestTime ? `, digest at ${cfg.digestTime}` : ', digest off'));
  let running = false;
  return cron.schedule('* * * * *', async () => {
    if (running) return; // a slow ntfy call shouldn't stack ticks
    running = true;
    try { await tick(db, cfg, new Date(), sendNtfy, log); } finally { running = false; }
  });
}

module.exports = { sendNtfy, tick, startScheduler, digestMessage };
