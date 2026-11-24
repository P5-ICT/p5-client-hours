import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Db } from "./db.js";
import { HttpError } from "./http.js";
import type { AppRole } from "./rules.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  jobTitle: string;
  departmentId: string | null;
  appRole: AppRole;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

const SESSION_HOURS = 12;
const INVITE_DAYS = 7;
/** A reset link opens the door to an account, so it is short-lived. An invite is for someone who has not started yet. */
const RESET_HOURS = 2;

export const hashPassword = (password: string) => bcrypt.hash(password, 11);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** A one-time token for invites and password resets. Only its hash is stored. */
export function newToken(kind: "invite" | "reset" = "invite"): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const ttl = kind === "reset" ? RESET_HOURS * 3_600_000 : INVITE_DAYS * 86_400_000;
  return { token, hash: sha256(token), expiresAt: new Date(Date.now() + ttl) };
}

/** `epoch` is the account's session_epoch. Raising it (on a password change) ends every session issued before. */
export function signSession(secret: string, userId: string, epoch: number): string {
  return jwt.sign({ ep: epoch }, secret, { subject: userId, expiresIn: `${SESSION_HOURS}h` });
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  job_title: string;
  department_id: string | null;
  app_role: AppRole;
  session_epoch?: number;
}

export const toAuthUser = (r: UserRow): AuthUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  jobTitle: r.job_title,
  departmentId: r.department_id,
  appRole: r.app_role,
});

/** Reads the bearer token, then loads the user from the database so a deactivated account or a changed role takes effect at once. */
export function requireAuth(db: Db, secret: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!token) throw new HttpError(401, "Sign in to continue.");
      let sub: string | undefined;
      let epoch: unknown;
      try {
        const payload = jwt.verify(token, secret) as jwt.JwtPayload;
        sub = payload.sub;
        epoch = payload.ep;
      } catch {
        throw new HttpError(401, "Your session has expired. Sign in again.");
      }
      const { rows } = await db.query<UserRow>(
        "select id, email, name, job_title, department_id, app_role, session_epoch from users where id = $1 and active and password_hash is not null",
        [sub],
      );
      const row = rows[0];
      if (!row) throw new HttpError(401, "This account is not active.");
      // A password change raises the epoch, which retires every token issued before it.
      if (epoch !== row.session_epoch) throw new HttpError(401, "Your password was changed. Sign in again.");
      req.user = toAuthUser(row);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(allowed: (role: AppRole) => boolean) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Sign in to continue."));
    if (!allowed(req.user.appRole)) return next(new HttpError(403, "You do not have access to this."));
    next();
  };
}
