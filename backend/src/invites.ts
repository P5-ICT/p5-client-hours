import type { Db } from "./db.js";
import { newToken } from "./auth.js";
import type { Mailer } from "./mail.js";

/** Issues a one-time "set your password" link. Used for new people and for forgotten passwords. */
export async function issueSetPasswordLink(
  db: Db,
  mailer: Mailer,
  appUrl: string,
  user: { id: string; email: string; name: string },
  kind: "invite" | "reset",
): Promise<{ link: string; emailed: boolean }> {
  const t = newToken(kind);
  await db.query("update users set token_hash = $1, token_expires_at = $2 where id = $3", [t.hash, t.expiresAt, user.id]);
  const link = `${appUrl.replace(/\/$/, "")}/set-password?token=${t.token}`;
  const emailed = await mailer.send({
    to: [user.email],
    subject: kind === "invite" ? "You have been added to P5 Client Hours" : "Reset your P5 Client Hours password",
    text:
      `Hi ${user.name},\n\n` +
      (kind === "invite" ? "You have been added to P5 Client Hours. Choose a password to start:\n" : "Use this link to choose a new password:\n") +
      `${link}\n\nThe link works for ${kind === "reset" ? "2 hours" : "7 days"} and can be used once.\n`,
  });
  return { link, emailed };
}
