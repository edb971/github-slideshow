'use strict';
// Due dates are stored as local 'YYYY-MM-DD' strings and times as 'HH:MM'.
// Recurrence math uses "floating" UTC dates (wall-clock date in UTC fields)
// so DST and the host timezone never shift an occurrence onto the wrong day.

const pad = (n) => String(n).padStart(2, '0');

const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = (now = new Date()) => toDateStr(now);

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s, n) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function isDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  return toDateStr(parseDateStr(s)) === s;
}

const isTimeStr = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

// Local Date for a task's due moment (start of day when there is no time).
function dueMoment(dateStr, timeStr) {
  const d = parseDateStr(dateStr);
  if (timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

function dateStrToUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const utcToDateStr = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'Wed 14 Oct'
function formatShort(s) {
  const d = parseDateStr(s);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// 'Today', 'Tomorrow', 'Yesterday', else 'Mon 3 Nov' (plus the year if it isn't this year).
function formatDay(s, todayStr) {
  if (s === todayStr) return 'Today';
  if (s === addDays(todayStr, 1)) return 'Tomorrow';
  if (s === addDays(todayStr, -1)) return 'Yesterday';
  const d = parseDateStr(s);
  const label = formatShort(s);
  return d.getFullYear() === parseDateStr(todayStr).getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

function formatDue(task, todayStr) {
  if (!task.due_date) return '';
  const day = formatDay(task.due_date, todayStr);
  return task.due_time ? `${day} ${task.due_time}` : day;
}

module.exports = {
  toDateStr, toTimeStr, today, parseDateStr, addDays, isDateStr, isTimeStr,
  dueMoment, dateStrToUTC, utcToDateStr, formatShort, formatDay, formatDue,
};
