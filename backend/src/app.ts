import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Db } from "./db.js";
import type { Env } from "./env.js";
import { errorHandler, HttpError } from "./http.js";
import type { Mailer } from "./mail.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { dataRoutes } from "./routes/data.js";
import { entryRoutes } from "./routes/entries.js";
import { extensionRoutes } from "./routes/extensions.js";
import { peopleRoutes } from "./routes/people.js";
import { timerRoutes } from "./routes/timer.js";

export interface AppContext {
  db: Db;
  env: Env;
  mailer: Mailer;
}

export function createApp(ctx: AppContext): Express {
  const app = express();
  // Render sits behind a proxy; this makes rate limiting see the real client address.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());

  const origins = ctx.env.CORS_ORIGIN.split(",").map((o) => o.trim().replace(/\/$/, ""));
  app.use(
    cors({
      origin(origin, cb) {
        // Requests without an Origin header (health checks, curl) are not browser cross-site calls.
        cb(null, !origin || origins.includes(origin));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    }),
  );
  app.use(express.json({ limit: "512kb" }));

  app.get("/health", async (_req, res) => {
    await ctx.db.query("select 1");
    res.json({ ok: true });
  });

  app.use("/api/auth", authRoutes(ctx));
  app.use("/api/data", dataRoutes(ctx));
  app.use("/api/timer", timerRoutes(ctx));
  app.use("/api/entries", entryRoutes(ctx));
  app.use("/api/extensions", extensionRoutes(ctx));
  app.use("/api/people", peopleRoutes(ctx));
  app.use("/api/admin", adminRoutes(ctx));

  app.use((_req, _res, next) => next(new HttpError(404, "Not found.")));
  app.use(errorHandler);
  return app;
}
