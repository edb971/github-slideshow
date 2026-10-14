'use strict';
const path = require('node:path');
const express = require('express');
const store = require('./tasks');
const views = require('./views');
const { today } = require('./dates');

// Only same-origin requests from localhost. Blocks DNS-rebinding (Host check)
// and other websites posting forms at the app (Origin / Sec-Fetch-Site check).
function localOnly(port) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  return (req, res, next) => {
    if (!hosts.has(req.headers.host)) return res.status(403).send('Forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) return res.status(403).send('Cross-origin request blocked');
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).send('Cross-site request blocked');
    }
    next();
  };
}

// Only allow redirects to local paths.
const safeBack = (b) => (typeof b === 'string' && /^\/(?!\/)/.test(b) ? b : '/today');

function withParams(back, params) {
  const u = new URL(safeBack(back), 'http://local');
  for (const k of ['added', 'done', 'error']) u.searchParams.delete(k);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.pathname + u.search;
}

// The current URL minus flash params: where actions on this page should return to.
const here = (req) => withParams(req.originalUrl, {});

function createApp(db, { port = 7878, now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localOnly(port));
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // Renders a page inside the layout with sidebar data and any ?added/?done/?error flash.
  function page(req, res, { title, active, body, quickDefaults, status = 200, query }) {
    let f = null;
    if (req.query.error) f = { error: String(req.query.error) };
    else if (req.query.added) {
      const t = store.getTask(db, Number(req.query.added));
      if (t) f = { added: t };
    } else if (req.query.done) {
      const cid = Number(req.query.done);
      const c = db.prepare('SELECT task_id FROM completions WHERE id = ?').get(cid);
      if (c) f = { done: { completionId: cid, task: store.getTask(db, c.task_id) } };
    }
    const nav = { counts: store.counts(db, now()), projects: store.projects(db), query };
    const back = here(req);
    res.status(status).type('html').send(String(views.layout({ title, active, body, nav, back, flash: f, quickDefaults })));
  }

  const ctx = (req, extra = {}) => {
    return { today: today(now()), back: here(req), ...extra };
  };

  app.get('/', (req, res) => res.redirect('/today'));

  app.get('/today', (req, res) => {
    const c = ctx(req);
    page(req, res, {
      title: 'Today', active: '/today', body: views.todayPage(store.todayView(db, now()), c),
      quickDefaults: { due_date: c.today },
    });
  });

  app.get('/upcoming', (req, res) => {
    page(req, res, { title: 'Upcoming', active: '/upcoming', body: views.upcomingPage(store.upcomingView(db, now()), ctx(req)) });
  });

  app.get('/inbox', (req, res) => {
    const body = views.listPage('Inbox', store.inboxTasks(db), ctx(req), 'Inbox zero. Tasks without a #project land here.');
    page(req, res, { title: 'Inbox', active: '/inbox', body });
  });

  app.get('/project/:name', (req, res) => {
    let name;
    try { name = store.cleanProject(req.params.name); } catch { name = null; }
    if (!name) return page(req, res, { title: 'Not found', body: views.notFoundPage(), status: 404 });
    const body = views.listPage(`#${name}`, store.projectTasks(db, name), ctx(req, { hideProject: true }),
      'No open tasks in this project.');
    page(req, res, { title: `#${name}`, active: `/project/${name}`, body, quickDefaults: { project: name } });
  });

  app.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const results = q ? store.search(db, q) : { open: [], done: [] };
    page(req, res, { title: q ? `Search: ${q}` : 'Search', body: views.searchPage(q, results, ctx(req)), query: q });
  });

  app.get('/done', (req, res) => {
    page(req, res, { title: 'Done', active: '/done', body: views.donePage(store.recentCompletions(db), ctx(req)) });
  });

  app.get('/task/:id', (req, res) => {
    const t = store.getTask(db, Number(req.params.id));
    if (!t) return page(req, res, { title: 'Not found', body: views.notFoundPage(), status: 404 });
    // "Back" returns to the list you came from (the Referer), never to another task page.
    let back = '/today';
    try {
      const ref = new URL(req.get('referer') || '');
      if (ref.host === req.headers.host && !ref.pathname.startsWith('/task/')) back = withParams(ref.pathname + ref.search, {});
    } catch { /* no or bad referer */ }
    const c = ctx(req, { back, projects: store.projects(db) });
    page(req, res, {
      title: t.title, body: views.taskPage(t, store.completionsFor(db, t.id), c),
      quickDefaults: t.project ? { project: t.project } : {},
    });
  });

  // Turns validation errors into a redirect back with ?error=..., so forms never dead-end.
  const action = (fn) => (req, res) => {
    try {
      res.redirect(303, fn(req, res));
    } catch (e) {
      if (!(e instanceof store.ValidationError)) throw e;
      res.redirect(303, withParams(req.body.back, { error: e.message }));
    }
  };

  app.post('/tasks', action((req) => {
    const t = store.quickAdd(db, req.body.q, {
      now: now(),
      defaults: { project: req.body.default_project || null, due_date: req.body.default_due || null },
    });
    return withParams(req.body.back, { added: t.id });
  }));

  app.post('/tasks/:id', action((req) => {
    const { title, notes, project, priority, due_date, due_time, recurrence } = req.body;
    const t = store.updateTask(db, Number(req.params.id),
      { title, notes, project, priority, due_date, due_time, recurrence }, now());
    if (!t) return '/today';
    return safeBack(req.body.back);
  }));

  app.post('/tasks/:id/complete', action((req) => {
    const r = store.completeTask(db, Number(req.params.id), now());
    return r ? withParams(req.body.back, { done: r.completionId }) : safeBack(req.body.back);
  }));

  app.post('/completions/:id/undo', action((req) => {
    store.undoCompletion(db, Number(req.params.id), now());
    return safeBack(req.body.back);
  }));

  app.post('/tasks/:id/delete', action((req) => {
    store.deleteTask(db, Number(req.params.id));
    return safeBack(req.body.back);
  }));

  app.use((req, res) => page(req, res, { title: 'Not found', body: views.notFoundPage(), status: 404 }));

  return app;
}

function main() {
  const cfg = require('./config');
  const { openDb } = require('./db');
  const { startScheduler } = require('./notify');
  const db = openDb(cfg.dbPath);
  const app = createApp(db, { port: cfg.port });
  const server = app.listen(cfg.port, cfg.host, () => {
    console.log(`taskman: http://localhost:${cfg.port}  (db: ${cfg.dbPath})`);
  });
  const job = startScheduler(db, cfg);
  const stop = () => {
    if (job) job.stop();
    server.close(() => { db.close(); process.exit(0); });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) main();

module.exports = { createApp };
