import { randomUUID } from "node:crypto";
import { audit } from "./audit.js";
import type { AppContext } from "./app.js";
import type { AuthUser } from "./auth.js";
import { isDemoEmail } from "./demo.js";
import { HttpError } from "./http.js";
import { issueSetPasswordLink } from "./invites.js";
import type { AppRole } from "./rules.js";

export interface NewPerson {
  name: string;
  email: string;
  jobTitle: string;
  departmentId: string | null;
  appRole: AppRole;
}

/** In the trial, testers may only add demo accounts, so the trial cannot be used to send emails to real addresses. */
export const demoMayAdd = (ctx: Pick<AppContext, "env">, actor: Pick<AuthUser, "email">, email: string) =>
  ctx.env.DEMO_DATA !== "1" || !isDemoEmail(actor.email) || isDemoEmail(email);

/**
 * Adds a person and sends them a link to choose their password. Used by the administrator's screen
 * and by managers, who may only add staff and client accounts (the route decides which roles are allowed).
 */
export async function createPerson(ctx: AppContext, actor: AuthUser, p: NewPerson) {
  if (!demoMayAdd(ctx, actor, p.email)) throw new HttpError(403, "In the trial, people can only be added with an email ending @pillar5group.com.", "email");
  const id = randomUUID();
  await ctx.db.query("insert into users (id, email, name, job_title, department_id, app_role) values ($1, $2, $3, $4, $5, $6)", [
    id,
    p.email,
    p.name,
    p.jobTitle,
    p.departmentId,
    p.appRole,
  ]);
  await audit(ctx.db, actor.id, "create", "user", id, { email: p.email, appRole: p.appRole });
  const invite = await issueSetPasswordLink(ctx.db, ctx.mailer, ctx.env.APP_URL, { id, email: p.email, name: p.name }, "invite");
  return { id, ...invite };
}
