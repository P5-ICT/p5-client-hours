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
  /** "1" turns on trial mode: ready-made test accounts and sample data (see src/demo.ts). Never set on a real system. */
  DEMO_DATA: z.string().optional(),
  /** The one password all demo accounts share. At least 10 characters. */
  DEMO_PASSWORD: z.string().optional(),
  /** "1" wipes the demo hours and starts the sample data again, on the next start. Ignored if real people have been added. */
  DEMO_RESET: z.string().optional(),
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
