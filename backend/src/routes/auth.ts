import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { audit } from "../audit.js";
import { checkPassword, hashPassword, requireAuth, sha256, signSession, toAuthUser } from "../auth.js";
import type { AppContext } from "../app.js";
import { HttpError, handler, parse } from "../http.js";
import { issueSetPasswordLink } from "../invites.js";
import { afterFailedLogin, isLocked, lockMinutesLeft, validatePassword } from "../rules.js";

// A real bcrypt hash, so unknown emails take as long to reject as wrong passwords.
const DUMMY_HASH = hashPassword("not-a-real-password");

export function authRoutes({ db, env, mailer }: AppContext) {
  const r = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: env.NODE_ENV === "test" ? 1000 : 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many attempts. Wait a few minutes and try again." },
  });

  const credentials = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

  r.post(
    "/login",
    limiter,
    handler(async (req, res) => {
      const { email, password } = parse(credentials, req.body);
      const { rows } = await db.query<{ id: string; password_hash: string | null; active: boolean; failed_logins: number; locked_until: Date | null; session_epoch: number }>(
        "select id, password_hash, active, failed_logins, locked_until, session_epoch from users where email = $1",
        [email],
      );
      const u = rows[0];
      const now = new Date();
      // A locked account is refused before the password is looked at, so guessing during a lock learns nothing.
      if (u && isLocked(u.locked_until, now)) {
        const minutes = lockMinutesLeft(u.locked_until, now);
        throw new HttpError(429, `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}, or use "Forgot your password?".`);
      }
      const ok = await checkPassword(password, u?.password_hash ?? (await DUMMY_HASH));
      if (!u || !u.password_hash || !u.active || !ok) {
        if (u && u.password_hash && u.active) {
          const next = afterFailedLogin(u.failed_logins, now);
          await db.query("update users set failed_logins = $1, locked_until = $2 where id = $3", [next.failedLogins, next.lockedUntil, u.id]);
          if (next.lockedUntil) await audit(db, u.id, "lockout", "user", u.id, { failedLogins: next.failedLogins });
        }
        throw new HttpError(401, "The email or password is wrong.");
      }
      await db.query("update users set failed_logins = 0, locked_until = null where id = $1", [u.id]);
      const user = await db.query<Parameters<typeof toAuthUser>[0]>(
        "select id, email, name, job_title, department_id, app_role from users where id = $1",
        [u.id],
      );
      await audit(db, u.id, "login", "user", u.id);
      res.json({ token: signSession(env.JWT_SECRET, u.id, u.session_epoch), user: toAuthUser(user.rows[0]!) });
    }),
  );

  const setPasswordBody = z.object({ token: z.string().min(20).max(200), password: z.string().max(200) });

  /** Accepts an invite or a reset link: sets the password and signs the person in. */
  r.post(
    "/set-password",
    limiter,
    handler(async (req, res) => {
      const { token, password } = parse(setPasswordBody, req.body);
      const bad = validatePassword(password);
      if (bad) throw new HttpError(400, bad.message, bad.field);
      const { rows } = await db.query<{ id: string }>(
        "select id from users where token_hash = $1 and token_expires_at > now() and active",
        [sha256(token)],
      );
      const u = rows[0];
      if (!u) throw new HttpError(400, "This link has expired or was already used. Ask for a new one.");
      // Setting a password (an invite, or a reset after a lock-out or a lost device) ends every older session and clears any lock.
      const set = await db.query<{ session_epoch: number }>(
        `update users set password_hash = $1, token_hash = null, token_expires_at = null,
           session_epoch = session_epoch + 1, failed_logins = 0, locked_until = null
         where id = $2 returning session_epoch`,
        [await hashPassword(password), u.id],
      );
      const user = await db.query<Parameters<typeof toAuthUser>[0]>(
        "select id, email, name, job_title, department_id, app_role from users where id = $1",
        [u.id],
      );
      await audit(db, u.id, "set-password", "user", u.id);
      res.json({ token: signSession(env.JWT_SECRET, u.id, set.rows[0]!.session_epoch), user: toAuthUser(user.rows[0]!) });
    }),
  );

  /** Always answers the same way, so it cannot be used to find out who has an account. */
  r.post(
    "/forgot",
    limiter,
    handler(async (req, res) => {
      const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
      const { rows } = await db.query<{ id: string; email: string; name: string }>(
        "select id, email, name from users where email = $1 and active",
        [email],
      );
      const u = rows[0];
      if (u) await issueSetPasswordLink(db, mailer, env.APP_URL, u, "reset");
      res.json({ ok: true });
    }),
  );

  const auth = requireAuth(db, env.JWT_SECRET);

  r.get(
    "/me",
    auth,
    handler(async (req, res) => {
      res.json({ user: req.user });
    }),
  );

  r.post(
    "/change-password",
    auth,
    limiter,
    handler(async (req, res) => {
      const { current, next } = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body);
      const bad = validatePassword(next);
      if (bad) throw new HttpError(400, bad.message, bad.field);
      const { rows } = await db.query<{ password_hash: string }>("select password_hash from users where id = $1", [req.user!.id]);
      if (!(await checkPassword(current, rows[0]!.password_hash))) throw new HttpError(400, "The current password is wrong.", "current");
      // Every other device is signed out; this one gets a fresh token so the person stays signed in here.
      const changed = await db.query<{ session_epoch: number }>(
        "update users set password_hash = $1, session_epoch = session_epoch + 1 where id = $2 returning session_epoch",
        [await hashPassword(next), req.user!.id],
      );
      await audit(db, req.user!.id, "change-password", "user", req.user!.id);
      res.json({ ok: true, token: signSession(env.JWT_SECRET, req.user!.id, changed.rows[0]!.session_epoch) });
    }),
  );

  return r;
}
