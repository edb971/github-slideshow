'use strict';
// Server-rendered HTML. `html` is a tagged template that escapes every
// interpolated value unless it was itself produced by `html`.
const { formatShort, formatDay, formatDue, today: todayStr } = require('./dates');

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
function render(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  return v instanceof Safe ? v.s : esc(v);
}
function html(strings, ...vals) {
  return new Safe(strings.reduce((out, s, i) => out + render(vals[i - 1]) + s));
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function backField(back) {
  return html`<input type="hidden" name="back" value="${back}">`;
}

function taskRow(t, ctx) {
  const overdue = t.due_date && t.due_date < ctx.today;
  const firstNote = t.notes ? t.notes.split('\n').find((l) => l.trim()) : '';
  const cls = ['task', `p${t.priority}`, overdue && 'overdue', t.virtual && 'virtual'].filter(Boolean).join(' ');
  return html`
  <li class="${cls}" data-id="${t.id}" data-href="/task/${t.id}">
    ${t.virtual
      ? html`<span class="check ghost" title="Future occurrence of a repeating task"></span>`
      : html`<form method="post" action="/tasks/${t.id}/complete" class="complete">
          ${backField(ctx.back)}<button class="check" title="Complete (x)" aria-label="Complete"></button>
        </form>`}
    <div class="body">
      <a class="title" href="/task/${t.id}">${t.title}</a>
      <div class="meta">
        ${t.due_date && !ctx.hideDue && html`<span class="due${overdue ? ' late' : ''}">${formatDue(t, ctx.today)}</span>`}
        ${t.due_time && ctx.hideDue && html`<span class="due">${t.due_time}</span>`}
        ${t.rrule && html`<span class="recur" title="${t.rrule}">↻ ${t.recur_text || 'repeats'}</span>`}
        ${t.project && !ctx.hideProject && html`<a class="proj" href="/project/${encodeURIComponent(t.project)}">#${t.project}</a>`}
        ${firstNote && html`<span class="note">✎ ${firstNote}</span>`}
      </div>
    </div>
  </li>`;
}

function taskList(tasks, ctx, empty = 'Nothing here.') {
  if (!tasks.length) return html`<p class="empty">${empty}</p>`;
  return html`<ul class="tasks">${tasks.map((t) => taskRow(t, ctx))}</ul>`;
}

function flash(f, back) {
  if (!f) return '';
  if (f.error) return html`<div class="flash error" role="alert">${f.error}</div>`;
  if (f.added) {
    const t = f.added;
    const bits = [
      t.due_date && formatDue(t, todayStr()),
      t.recur_text && `↻ ${t.recur_text}`,
      t.project && `#${t.project}`,
      t.priority < 4 && `p${t.priority}`,
    ].filter(Boolean);
    return html`<div class="flash">Added <a href="/task/${t.id}">${t.title}</a>
      ${bits.length ? html`<span class="muted">· ${bits.join(' · ')}</span>` : html`<span class="muted">· no date</span>`}</div>`;
  }
  if (f.done) {
    const { task, completionId } = f.done;
    return html`<div class="flash">Completed <a href="/task/${task.id}">${task.title}</a>
      ${!task.completed_at && task.due_date && html`<span class="muted">· next ${formatDue(task, todayStr())}</span>`}
      <form method="post" action="/completions/${completionId}/undo" id="undo-form" class="inline">
        ${backField(back)}<button class="link">Undo (z)</button>
      </form></div>`;
  }
  return '';
}

const HELP = [
  ['n', 'New task (quick add)'], ['/', 'Search'], ['j / k', 'Move down / up'],
  ['x', 'Complete selected task'], ['z', 'Undo last completion'], ['Enter / e', 'Open selected task'],
  ['t', 'Today'], ['u', 'Upcoming'], ['i', 'Inbox'], ['d', 'Done'],
  ['Esc', 'Leave a text field'], ['Ctrl+Enter', 'Save the task you are editing'], ['?', 'This help'],
];

function layout({ title, active, body, nav, back, flash: f, quickDefaults = {} }) {
  const navLink = (href, label, key, count, late) => html`
    <a href="${href}" class="${active === href ? 'active' : ''}"><span>${label}</span>
      ${count ? html`<span class="count${late ? ' late' : ''}">${count}</span>` : ''}<kbd>${key}</kbd></a>`;
  return html`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · taskman</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%23d1453b'/><path d='M4 8.5l2.5 2.5L12 5.5' stroke='white' stroke-width='2' fill='none'/></svg>">
</head><body>
<aside class="side">
  <a href="/today" class="brand">taskman</a>
  <nav>
    ${navLink('/today', 'Today', 't', nav.counts.today, nav.counts.overdue > 0)}
    ${navLink('/upcoming', 'Upcoming', 'u')}
    ${navLink('/inbox', 'Inbox', 'i', nav.counts.inbox)}
    ${navLink('/done', 'Done', 'd')}
  </nav>
  <h3>Projects</h3>
  <nav class="projects">
    ${nav.projects.length ? nav.projects.map((p) => html`
      <a href="/project/${encodeURIComponent(p.name)}" class="${active === `/project/${p.name}` ? 'active' : ''}">
        <span>#${p.name}</span><span class="count">${p.count}</span></a>`)
      : html`<p class="muted small">Add <code>#name</code> to a task to make a project.</p>`}
  </nav>
  <p class="muted small keys-hint">Press <kbd>?</kbd> for shortcuts</p>
</aside>
<main>
  <header class="bar">
    <form method="post" action="/tasks" class="quick" autocomplete="off">
      ${backField(back)}
      ${quickDefaults.project && html`<input type="hidden" name="default_project" value="${quickDefaults.project}">`}
      ${quickDefaults.due_date && html`<input type="hidden" name="default_due" value="${quickDefaults.due_date}">`}
      <input id="quick" name="q" placeholder="Add a task: call Sam tomorrow 4pm #home p2" aria-label="Quick add (n)">
      <kbd>n</kbd>
    </form>
    <form method="get" action="/search" class="search" role="search">
      <input id="search" name="q" type="search" placeholder="Search" aria-label="Search (/)" value="${nav.query || ''}">
      <kbd>/</kbd>
    </form>
  </header>
  ${flash(f, back)}
  ${body}
</main>
<div id="help" class="help" hidden>
  <div class="help-box" role="dialog" aria-label="Keyboard shortcuts">
    <h2>Keyboard</h2>
    <dl>${HELP.map(([k, d]) => html`<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`)}</dl>
    <h2>Quick add</h2>
    <p><code>tomorrow 4pm</code>, <code>fri</code>, <code>oct 31</code>, <code>in 3 days</code> ·
       <code>#project</code> · <code>p1</code>–<code>p3</code> ·
       <code>every mon,thu</code>, <code>every 1st</code>, <code>every other day</code>, <code>every weekday</code> ·
       wrap text in <code>"quotes"</code> to keep it literal.</p>
  </div>
</div>
<script src="/app.js"></script>
</body></html>`;
}

function todayPage({ overdue, today }, ctx) {
  const total = overdue.length + today.length;
  return html`
  <h1>Today <span class="sub">${formatShort(ctx.today)}</span></h1>
  ${overdue.length > 0 && html`
    <section class="overdue-block">
      <h2 class="late">Overdue <span class="sub">${overdue.length}</span></h2>
      ${taskList(overdue, ctx)}
    </section>`}
  ${overdue.length > 0 && today.length > 0 && html`<h2>Today <span class="sub">${today.length}</span></h2>`}
  ${total === 0
    ? html`<p class="empty">Nothing due today. Press <kbd>n</kbd> to add something.</p>`
    : today.length > 0 && taskList(today, { ...ctx, hideDue: true })}`;
}

function upcomingPage({ overdue, days }, ctx) {
  return html`
  <h1>Upcoming <span class="sub">next 7 days</span></h1>
  ${overdue.length > 0 && html`
    <section class="overdue-block">
      <h2 class="late">Overdue <span class="sub">${overdue.length}</span></h2>
      ${taskList(overdue, ctx)}
    </section>`}
  ${days.map((d) => html`
    <section class="day">
      <h2>${formatDay(d.date, ctx.today)} <span class="sub">${d.date}</span></h2>
      ${taskList(d.tasks, { ...ctx, hideDue: true }, 'Nothing scheduled.')}
    </section>`)}`;
}

function listPage(title, tasks, ctx, empty) {
  return html`<h1>${title} <span class="sub">${plural(tasks.length, 'task')}</span></h1>${taskList(tasks, ctx, empty)}`;
}

function searchPage(q, { open, done }, ctx) {
  if (!q) return html`<h1>Search</h1><p class="empty">Type in the search box (<kbd>/</kbd>). Matches titles, notes and projects.</p>`;
  return html`
  <h1>Search <span class="sub">“${q}”</span></h1>
  ${taskList(open, ctx, 'No open tasks match.')}
  ${done.length > 0 && html`<h2>Completed</h2>
    <ul class="tasks done-list">${done.map((t) => html`
      <li class="task done"><span class="check ghost done"></span><div class="body">
        <a class="title" href="/task/${t.id}">${t.title}</a>
        <div class="meta"><span>done ${t.completed_at.slice(0, 10)}</span>${t.project && html`<span>#${t.project}</span>`}</div>
      </div></li>`)}</ul>`}`;
}

function donePage(rows, ctx) {
  const seen = new Set();
  return html`
  <h1>Done <span class="sub">recent completions</span></h1>
  ${rows.length === 0 ? html`<p class="empty">Nothing completed yet.</p>` : html`
  <ul class="tasks done-list">${rows.map((r) => {
    const canUndo = !seen.has(r.id);
    seen.add(r.id);
    const when = new Date(r.done_at);
    return html`
    <li class="task done"><span class="check ghost done"></span><div class="body">
      <a class="title" href="/task/${r.id}">${r.title}</a>
      <div class="meta">
        <span>${formatDay(todayStr(when), ctx.today)} ${when.toTimeString().slice(0, 5)}</span>
        ${r.rrule && html`<span class="recur">↻ ${r.recur_text || 'repeats'}</span>`}
        ${r.project && html`<a class="proj" href="/project/${encodeURIComponent(r.project)}">#${r.project}</a>`}
        ${canUndo && html`<form method="post" action="/completions/${r.completion_id}/undo" class="inline">
          ${backField(ctx.back)}<button class="link">undo</button></form>`}
      </div></div></li>`;
  })}</ul>`}`;
}

function taskPage(t, history, ctx) {
  const repeat = t.recur_text || t.rrule || '';
  return html`
  <h1 class="${t.completed_at ? 'strike' : ''}">${t.title}</h1>
  ${t.completed_at && html`<p class="muted">Completed ${t.completed_at.slice(0, 10)}.</p>`}
  <form method="post" action="/tasks/${t.id}" class="edit" id="edit-form">
    ${backField(ctx.back)}
    <label class="wide">Title <input name="title" value="${t.title}" required></label>
    <label>Due date <input type="date" name="due_date" value="${t.due_date || ''}"></label>
    <label>Time <input type="time" name="due_time" value="${t.due_time || ''}"></label>
    <label>Priority
      <select name="priority">${[1, 2, 3, 4].map((p) => html`
        <option value="${p}" ${t.priority === p ? 'selected' : ''}>${p === 4 ? 'None' : `p${p}`}</option>`)}
      </select></label>
    <label>Project <input name="project" value="${t.project || ''}" list="projects" placeholder="inbox"></label>
    <datalist id="projects">${ctx.projects.map((p) => html`<option value="${p.name}">`)}</datalist>
    <label class="wide">Repeat <input name="recurrence" value="${repeat}" placeholder="every mon,thu · every 1st · RRULE:FREQ=…">
      ${t.rrule && html`<span class="muted small mono">${t.rrule}</span>`}</label>
    <label class="wide">Notes <textarea name="notes" rows="8">${t.notes}</textarea></label>
    <div class="actions wide">
      <button class="primary">Save <kbd>Ctrl+Enter</kbd></button>
      <a href="${ctx.back}" class="button">Back</a>
    </div>
  </form>
  <div class="actions">
    ${!t.completed_at && html`<form method="post" action="/tasks/${t.id}/complete" id="complete-form" class="inline">
      <input type="hidden" name="back" value="/task/${t.id}"><button>Complete <kbd>x</kbd></button></form>`}
    <form method="post" action="/tasks/${t.id}/delete" class="inline" id="delete-form"
          data-confirm="Delete “${t.title}” permanently?">
      ${backField(ctx.back)}<button class="danger">Delete</button></form>
  </div>
  ${history.length > 0 && html`
    <h2>History</h2>
    <ul class="history">${history.map((c) => html`
      <li>Completed ${new Date(c.completed_at).toLocaleString()}${c.due_date && html` <span class="muted">(was due ${c.due_date})</span>`}</li>`)}
    </ul>`}`;
}

function notFoundPage() {
  return html`<h1>Not found</h1><p class="empty"><a href="/today">Back to Today</a></p>`;
}

module.exports = {
  html, layout, todayPage, upcomingPage, listPage, searchPage, donePage, taskPage, notFoundPage,
};
