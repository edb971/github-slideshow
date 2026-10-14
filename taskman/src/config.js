'use strict';
// Loads .env from the package directory (not the cwd) so `t` works from any terminal.
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

function defaultDbPath() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'taskman', 'tasks.db');
}

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

const env = process.env;

module.exports = {
  root: ROOT,
  port: Number(env.PORT) || 7878,
  host: '127.0.0.1',
  dbPath: path.resolve(expandHome(env.TASKMAN_DB || defaultDbPath())),
  ntfy: {
    server: (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, ''),
    topic: (env.NTFY_TOPIC || '').trim(),
    token: (env.NTFY_TOKEN || '').trim(),
  },
  digestTime: env.DIGEST_TIME === undefined ? '07:00' : env.DIGEST_TIME.trim(),
  remindBeforeMinutes: Math.max(0, Number(env.REMIND_BEFORE_MINUTES) || 0),
};
