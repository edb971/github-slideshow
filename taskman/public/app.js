// Keyboard layer. Every action is a plain form or link, so the app also works without JS.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const rows = [...document.querySelectorAll('li.task[data-id]')];
  const help = $('#help');
  const selKey = `sel:${location.pathname}${location.search.replace(/[?&](added|done|error)=[^&]*/g, '')}`;
  let sel = -1;

  function select(i, scroll = true) {
    if (!rows.length) return;
    sel = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, j) => r.classList.toggle('selected', j === sel));
    if (scroll) rows[sel].scrollIntoView({ block: 'nearest' });
    try { sessionStorage.setItem(selKey, String(sel)); } catch { /* storage unavailable */ }
  }

  // Restore the selection after a reload (e.g. after completing with x).
  try {
    const saved = sessionStorage.getItem(selKey);
    if (saved !== null && rows.length) select(Number(saved), false);
  } catch { /* storage unavailable */ }

  rows.forEach((r, i) => r.addEventListener('mousedown', () => select(i, false)));

  const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const go = (href) => { location.href = href; };

  // Delete needs a confirm; everything else is reversible.
  const del = $('#delete-form');
  if (del) del.addEventListener('submit', (e) => { if (!confirm(del.dataset.confirm)) e.preventDefault(); });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (isTyping(t)) {
      if (e.key === 'Escape') t.blur();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.form) { e.preventDefault(); t.form.requestSubmit(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!help.hidden) {
      if (e.key === 'Escape' || e.key === '?') help.hidden = true;
      return;
    }
    const current = rows[sel];
    const handlers = {
      n: () => $('#quick').focus(),
      '/': () => $('#search').select(),
      j: () => select(sel + 1), ArrowDown: () => select(sel + 1),
      k: () => select(sel < 0 ? 0 : sel - 1), ArrowUp: () => select(sel < 0 ? 0 : sel - 1),
      x: () => {
        const form = current ? current.querySelector('form.complete') : $('#complete-form');
        if (form) form.requestSubmit();
      },
      z: () => { const f = $('#undo-form'); if (f) f.requestSubmit(); },
      Enter: () => current && go(current.dataset.href),
      e: () => (current ? go(current.dataset.href) : $('#edit-form input[name=title]')?.focus()),
      o: () => current && go(current.dataset.href),
      t: () => go('/today'), u: () => go('/upcoming'), i: () => go('/inbox'), d: () => go('/done'),
      '?': () => { help.hidden = false; },
      Escape: () => { if (current) { current.classList.remove('selected'); sel = -1; } },
    };
    const h = handlers[e.key];
    if (h) { e.preventDefault(); h(); }
  });

  help.addEventListener('click', (e) => { if (e.target === help) help.hidden = true; });
})();
