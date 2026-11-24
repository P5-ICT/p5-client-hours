# Drizzle draft (not used)

A schema started on another PC that had the Next.js app talking to Postgres directly, with cookie sessions and
several clients. The project went with a separate Express API (`backend/`) instead, so this is kept for reference only.
It is outside `frontend/` on purpose: Vercel builds `frontend/` alone, and these files import packages it does not have.

Ideas worth borrowing later: more than one client (`clients` table, `client_id` on users, projects and entries),
failed-login counters and lockout, server-side sessions that can be revoked.
