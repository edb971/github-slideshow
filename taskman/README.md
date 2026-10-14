# taskman

A personal task manager meant to replace Todoist. It's a local web app on your
own machine, built with Node, Express and SQLite. It's keyboard-first, and it
pushes reminders to your phone through [ntfy](https://ntfy.sh).

- One SQLite file holds everything. There are no accounts, no telemetry and no
  cloud. The only thing that leaves your machine is the ntfy push.
- The server binds to `127.0.0.1` only and refuses cross-site requests, so
  other machines on your network and other websites can't reach it.
- Your phone gets notifications only. There is no mobile app and no sync, and
  that's deliberate.

## Setup

Requires Node 20 or newer.

```sh
cd taskman
npm install
cp .env.example .env      # then set NTFY_TOPIC (see below)
npm start                 # → http://localhost:7878
npm link                  # optional: puts the `t` command on your PATH
```

To keep it running, use whatever your OS already provides, such as a systemd
user unit, a launchd agent or `pm2`. Here's a systemd example
(`~/.config/systemd/user/taskman.service`):

```ini
[Unit]
Description=taskman

[Service]
WorkingDirectory=%h/path/to/taskman
ExecStart=/usr/bin/node src/server.js
Restart=on-failure

[Install]
WantedBy=default.target
```

Then run `systemctl --user enable --now taskman`.

## Quick add

You can type a whole task on one line in the web app (`n`) or with `t add`:

```
call Sam tomorrow 4pm #home p2
pay rent every 1st #home p1
gym every mon,thu 7am #health
file taxes by oct 31 p1
standup every weekday 9am #work
watch "Friday Night Lights" #tv      ← quoted text is never parsed
```

| You type | Result |
| --- | --- |
| `tomorrow 4pm`, `fri`, `oct 31`, `in 3 days`, `next week` | Due date and time, parsed by chrono-node. A time on its own (`4pm`) means today. |
| `#home` | Project. Lowercased. A task with no project goes to the Inbox. |
| `p1` `p2` `p3` | Priority. `p4` or nothing means no priority. |
| `every day`, `every other day`, `every 2 weeks`, `every weekday`, `every weekend` | Repeats on that schedule. |
| `every mon,thu`, `every mon and thu`, `every other fri` | Repeats on those weekdays. |
| `every 1st`, `every 1st and 15th`, `every last day` | Repeats on those days of the month. |
| `… daily`, `… weekly`, `… monthly` | Shorthands, but only after the title, so a task called "weekly review" keeps its name. |

Repeat rules are stored as RRULE strings (`RRULE:FREQ=WEEKLY;BYDAY=MO,TH`).
The task page also takes a raw RRULE in the Repeat field, so you can use
anything RFC 5545 supports.

When you complete a recurring task, the completion is logged in its history
and the task moves to the next occurrence after today. If you finish an
overdue daily task, you get one task for tomorrow rather than a pile of
missed copies.

Adding from the Today view with no date makes the task due today. Adding from
a project page with no `#tag` puts it in that project.

## Keyboard

| Key | Action |
| --- | --- |
| `n` | New task (quick add) |
| `/` | Search titles, notes and projects |
| `j` / `k` | Move the selection down / up |
| `x` | Complete the selected task |
| `z` | Undo the last completion |
| `Enter` / `e` | Open the selected task |
| `t` `u` `i` `d` | Go to Today, Upcoming, Inbox, Done |
| `Ctrl+Enter` | Save the task you're editing |
| `Esc` | Leave a text field |
| `?` | Show all shortcuts |

## Views

- **Today** shows overdue tasks pinned in red at the top, then today's tasks by
  priority and time.
- **Upcoming** shows overdue tasks, then the next 7 days grouped by day. Later
  occurrences of a recurring task appear greyed out with a dashed circle.
- **Inbox** lists open tasks that have no project.
- **#project** pages list one project's open tasks, soonest first.
- **Done** lists recent completions. Each task's most recent completion has an
  undo link.

## The `t` CLI

```sh
t add "call Sam tomorrow 4pm #home p2"    # the quotes are optional, but a # needs quoting in some shells
t today          # overdue + today (also: t ls)
t upcoming       # next 7 days
t done 12        # complete task 12 (ids are shown in t today)
t search dentist
t backup ~/tasks-backup.db
t notify-test    # send a test push to check your ntfy setup
t where          # print the database path
```

`t` writes straight to the database, so it works whether or not the server is
running. It reads the `.env` in this directory no matter where you run it from.

## Phone setup (ntfy)

ntfy is a free, open-source push service. The server posts to a *topic*, and
the ntfy app on your phone subscribes to the same topic.

1. Install **ntfy** on your phone. It's in the
   [Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy),
   on [F-Droid](https://f-droid.org/packages/io.heckel.ntfy/) and in the
   [App Store](https://apps.apple.com/app/ntfy/id1625396347).
2. Choose a topic name that is **long and unguessable**, for example
   `tasks-7f3k9q2xv8`. On the public ntfy.sh server there are no accounts, and
   anyone who knows the topic name can read your messages.
3. In the app, tap **+** (Subscribe to topic), enter the topic name, and keep
   the server as `ntfy.sh` (or enter your own).
4. Put the same name in `.env`:
   ```
   NTFY_TOPIC=tasks-7f3k9q2xv8
   ```
5. Run `t notify-test`. A push should arrive within a few seconds.
6. On Android, open the topic's settings in the ntfy app. Turn on **instant
   delivery**, and allow the app to ignore battery optimisation so reminders
   aren't delayed. On iOS, allow notifications for ntfy when it asks.

What gets pushed:

- **Reminders** go out for tasks that have a due *time*, at that time, or
  `REMIND_BEFORE_MINUTES` early. Each due time is pushed once. p1 tasks are
  sent as urgent and p2 as high priority. Tasks with only a date are covered by
  the digest instead.
- **The daily digest** goes out at `DIGEST_TIME` (default `07:00`) with
  today's tasks and anything overdue. If the machine was asleep at 7, it is
  sent when the machine wakes, as long as that's within 4 hours.

A check runs every minute (node-cron). A failed push is retried on the next
minute. A reminder more than an hour past due is dropped rather than sent, so
restarting after a long gap doesn't flood your phone.

Privacy: task titles, times and the first part of the notes pass through the
ntfy server. To keep them on your own hardware, [self-host
ntfy](https://docs.ntfy.sh/install/) and set `NTFY_SERVER`, plus `NTFY_TOKEN`
if you turn on access control. The phone can't reach the web app, since it
only listens on localhost, so the notifications don't link to it.

## Where the data lives

Everything is in **one SQLite file**:

- the default is `~/.local/share/taskman/tasks.db` (or
  `$XDG_DATA_HOME/taskman/tasks.db`)
- set `TASKMAN_DB=/some/path/tasks.db` in `.env` to put it somewhere else
- run `t where` to print the current path

The database runs in WAL mode, so the server and the CLI can use it at the
same time. As a result you'll see `tasks.db-wal` and `tasks.db-shm` next to it
while the server is running. To back it up:

- **`t backup <file>`** is safe at any time and writes one self-contained file.
- Copying `tasks.db` by hand is fine while the server is stopped.
- Pointing `TASKMAN_DB` into a synced folder (Dropbox, Syncthing) works for
  backup, but only run taskman on one machine at a time.

The schema is plain: `tasks`, `completions` (the history of recurring tasks,
which undo also uses) and `meta`. You can query it directly with `sqlite3`.

## Configuration (`.env`)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `7878` | Web UI port. The server always binds to 127.0.0.1. |
| `TASKMAN_DB` | `~/.local/share/taskman/tasks.db` | Database file. |
| `NTFY_SERVER` | `https://ntfy.sh` | ntfy server. |
| `NTFY_TOPIC` | *(empty: pushes off)* | Your topic. |
| `NTFY_TOKEN` | | Access token for protected topics. |
| `DIGEST_TIME` | `07:00` | Local time of the daily digest. Empty turns it off. |
| `REMIND_BEFORE_MINUTES` | `0` | How early to push timed reminders. |
| `TZ` | system | Force a timezone, e.g. `Europe/London`. |

## Development

```sh
npm test         # node:test: the parser, recurrence, views data, the scheduler
```

The code is in `src/`:

- `parse.js` is the quick-add parser.
- `recur.js` does the RRULE math.
- `tasks.js` holds every query.
- `notify.js` has the ntfy client and the per-minute tick.
- `views.js` renders the HTML with escaping.
- `server.js` holds the routes.

Out of scope on purpose: collaboration, native mobile apps and offline sync.
