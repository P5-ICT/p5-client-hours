# P5 Client Hours

The system Pillar 5 Group uses to track the hours spent on a client's projects. Staff from every department log their time. A manager approves it. The client sees how many of the hours allocated (for example 45 per 2-week cycle) were used, and how many extra hours Pillar 5 delivered.

Built by Sibabalwe Ngandana (ICT, Pillar 5 Group).

## Two projects in one repo

| Folder | Stack | Hosting |
|---|---|---|
| `frontend/` | Next.js (App Router), React, TypeScript, Tailwind v4, Vitest | Render |
| `backend/` | Express, TypeScript, PostgreSQL (`pg`), JWT sign-in, Vitest and supertest | Render |

Deployment steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). What changed after the team meeting, and the open questions, are in [docs/MEETING-CHANGES.md](docs/MEETING-CHANGES.md). The plan and the reasons behind the design are in [docs/PRODUCTION-PLAN.md](docs/PRODUCTION-PLAN.md).

## Run it on your computer

```bash
# Terminal 1: the API. Uses an in-process Postgres, so there is nothing to install.
cd backend
npm install
npm run dev:local        # http://localhost:4000   sign in: admin@example.com / local-admin-password

# Terminal 2: the website
cd frontend
npm install
cp .env.example .env.local
npm run dev              # http://localhost:3000
```

Sign in as the admin, then add a project and a few people under **Management > Team and settings**. With no email configured, the screen shows each person's "set your password" link to copy.

## How it works

1. **Hours allocated.** The client has a set number of hours each cycle, which can be split between departments (for example marketing gets 8 of the 45). The cycle resets every N days from a start date. Cycles are worked out in `Africa/Johannesburg` time. Management can add hours to a cycle, with a reason.
2. **Staff track time.** Each person picks a project, starts the timer and writes a short note. The timer lives on the server, so it can be started on a phone and stopped on a laptop. A timer has to run for a minimum time (a setting) before it can be submitted. If they forgot it, they can type in the hours with a reason. Management can type hours in for other people.
3. **Managers approve.** Every entry waits for approval. Only approved hours count. Nobody approves their own hours, or hours they typed in for someone else.
4. **Reports.** The client signs in and sees approved hours only. Management has the same report under **Reports**. Both can look at a cycle, a week or a month; read a summary of the work that the system writes from the approved entries; and download Excel, CSV or a PDF.
5. **Alerts and reminders.** Managers get one email when approved hours reach 80% and one at 100% of the hours allocated, and one when a cycle ends with its figures. Someone who leaves a timer running overnight gets a reminder.

## Who can do what

| Account | Can |
|---|---|
| Staff | Log time, delete their own pending entries, see the overview (other people's hours only, no notes) |
| Manager, CEO | Everything staff can, plus see all entries, approve or reject (never their own), log time for other people, add hours to a cycle, pull reports, and **add the people on their team** (staff and client accounts only) |
| Admin | See all entries, manage people, projects, department hours and settings, log time for others and add hours to a cycle. Does not approve hours |
| Client | See approved hours for the client, nothing else |

The server enforces this. The database also refuses to edit or delete a reviewed entry, to create an entry as approved, or to let someone review their own entry.

## Sign-in and account safety

- Everyone signs in with their own email and password (10 or more characters). People are invited by an administrator.
- Five wrong passwords in a row lock that account for 5 minutes, then 15, then 60. A reset link clears the lock.
- Changing a password (or using a reset link) signs out every other device.
- Reset links last 2 hours, invitations 7 days, and each works once.
- People change their own password from their name at the top right (`/account`).

## API

All routes are under `/api` and need `Authorization: Bearer <token>` except sign-in.

| Route | What |
|---|---|
| `POST /auth/login`, `/auth/set-password`, `/auth/forgot`, `/auth/change-password`, `GET /auth/me` | Sign-in, invites and resets |
| `GET /data?back=N` | Everything the signed-in person may see. Entries come a cycle at a time (default: this cycle and the one before; `back` asks for more) |
| `POST /timer`, `/timer/pause`, `/timer/resume`, `/timer/stop`, `PATCH`/`DELETE /timer` | The running timer |
| `POST /entries`, `DELETE /entries/:id` | Typed-in hours (management can name another person); delete a pending entry |
| `POST /extensions`, `DELETE /extensions/:id` | Add hours to a cycle, or remove them (management) |
| `POST /entries/:id/review`, `/entries/approve-timer-entries` | Approve or reject |
| `PUT /admin/settings`, `POST`/`PATCH /admin/users`, `/admin/projects`, `/admin/departments` (including each department's hours), `POST /admin/import` | Admin only |

## Checks before you finish a change

```bash
cd backend  && npm test && npm run typecheck && npm run lint && npm run build
cd frontend && npm test && npm run typecheck && npm run lint && npm run build
```

GitHub Actions runs the same on every pull request (`.github/workflows/ci.yml`).

## Layout

```
backend/
  src/
    app.ts            Express app (CORS, security headers, routes)
    server.ts         Start-up: migrate, create the first admin, listen
    rules.ts          Pure business rules (roles, cycles, alert thresholds)
    routes/           auth, data, timer, entries, admin
    jobs/alerts.ts    80% / 100% emails
    migrations/       SQL, applied in order on start
  test/               Rules, and the API against a real Postgres (PGlite)
frontend/
  src/
    app/              Routes (App Router), including /login and /set-password
    components/       Shell, views, UI primitives
    lib/              api.ts (server calls), auth.tsx, store.tsx, and the pure rules
legacy/index.html     The original single-file demo. Reference only
legacy/drizzle-draft/ An unused schema draft started on another PC. Reference only
render.yaml           Render Blueprint (API, database, alert job)
```
