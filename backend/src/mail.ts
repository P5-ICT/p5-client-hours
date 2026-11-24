import type { Env } from "./env.js";

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

export interface Mailer {
  /** Returns true when the message was handed to the mail service. */
  send(mail: Mail): Promise<boolean>;
}

/** Sends through Resend. Without an API key it logs the message instead, so local work and tests need no account. */
export function createMailer(env: Pick<Env, "RESEND_API_KEY" | "MAIL_FROM">): Mailer {
  return {
    async send(mail) {
      // "none" lets a first deploy go ahead before the Resend account exists.
      if (!env.RESEND_API_KEY || env.RESEND_API_KEY.trim().toLowerCase() === "none") {
        console.log(`[mail not sent: email not configured] to=${mail.to.join(",")} subject="${mail.subject}"`);
        return false;
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text }),
      });
      if (!res.ok) {
        console.error(`[mail failed] ${res.status} ${await res.text()}`);
        return false;
      }
      return true;
    },
  };
}
