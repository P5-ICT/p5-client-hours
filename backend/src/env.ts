import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  /** Comma separated list of allowed browser origins, e.g. https://p5-hours.vercel.app */
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Public URL of the frontend, used to build invite and reset links. */
  APP_URL: z.string().default("http://localhost:3000"),
  /** The first admin. Created on start-up if no admin exists yet. */
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().default("Admin"),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("P5 Client Hours <onboarding@resend.dev>"),
  /** Set to "1" on the database host if it requires TLS (Render external URLs do). */
  DATABASE_SSL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
