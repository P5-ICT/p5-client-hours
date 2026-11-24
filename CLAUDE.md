# P5 Client Hours

Two projects in one repo. `frontend/` is Next.js (App Router) + TypeScript + Tailwind v4 + Vitest, hosted on Render. `backend/` is Express + TypeScript + Postgres + Vitest, hosted on Render too. See `docs/DEPLOYMENT.md`.

## Frontend (`frontend/`)

- Business rules are pure functions in `src/lib` (`actions.ts`, `cycles.ts`, `periods.ts`, `executive.ts`, `excel.ts`, `csv.ts`). Add a test in `src/lib/logic.test.ts` for any rule you change.
- Server data goes through `src/lib/api.ts` and the store in `src/lib/store.tsx`. Screens call `mutate(optimistic, request)`; they never write to the server directly or keep their own copy of the data. Test fixtures live in `src/lib/test-data.ts` and are not used by the app.
- Views are client components in `src/components/views`; routes in `src/app` just render them. Access by role is decided in `src/lib/auth.tsx` and enforced again by the server.
- Colours are CSS variables in `src/app/globals.css` (light and dark), exposed to Tailwind as `bg-surface`, `text-muted`, `border-line`, etc. Do not hard-code hex values.
- Never write "paid hours" on a screen, report or email: the client must not think they only pay for hours worked. Say "hours allocated" (the cap) and "hours used" (approved so far).
- Keep the accessibility basics: labelled fields, 44px targets, visible focus, 4.5:1 contrast.
- Check before finishing: `cd frontend && npm test && npm run typecheck && npm run lint && npm run build`.

## Backend (`backend/`)

- The server is the source of truth for permissions. Every route checks the role (`requireRole` in `src/auth.ts`, rules in `src/rules.ts`). Never trust the frontend to hide things.
- Rules that protect the data are also in SQL (`src/migrations`): reviewed entries are final, new entries are forced to pending, nobody reviews their own entry. Change schema with a new numbered migration file; never edit one that has been applied.
- `src/rules.ts` is pure and has no database or HTTP. Put new business rules there and test them in `test/rules.test.ts`. API behaviour is tested in `test/api.test.ts` against real Postgres (PGlite).
- Data scoping per role is in `src/routes/data.ts`. If you add a field to an entry, decide who may see it there.
- Sessions are JWTs that carry the account's `session_epoch`. Any change that must sign other devices out (a password change or a reset) raises it. Lock-out counting is per account (`afterFailedLogin` in `rules.ts`).
- Scheduled jobs live in `src/jobs` and are run by the cron entries in `render.yaml`. Each one claims its work with an insert that has a primary key (`alerts_sent`, `cycle_reports`, `timer_reminders`), so an overlapping run cannot send twice.
- `/api/data` loads a window of cycles (`?back=N`), not all history, and always includes pending entries. The frontend asks for more through `loadHistory` (the cycle picker and the reports page).
- Write an `audit()` row for every approve, reject, delete, extend-hours, lock-out and settings or people change.
- Hours typed in for someone else carry `logged_by`; the logger can never be the reviewer (route check and a database constraint).
- Keep `backend/src/rules.ts` and `frontend/src/lib/actions.ts` in agreement (note length, proof links, manual-entry checks).
- Check before finishing: `cd backend && npm test && npm run typecheck && npm run lint && npm run build`.

`legacy/index.html` is the original single-file demo. Reference only.

OneDrive sets a file aside as `name-COMPUTERNAME.ext` when two computers edit it at once. Those are never source: merge what is wanted, then delete them. They are git-ignored.

Migrations are numbered in the order they must run, one number per file. Never reuse a number.
