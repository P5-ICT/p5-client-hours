import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodType } from "zod";

/** An error with a status code and a message that is safe to show the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** Express 5 forwards rejected promises, but this keeps handlers explicit about being async. */
export const handler = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

export function parse<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new HttpError(400, issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid request.", issue?.path.join(".") || undefined);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, field: err.field });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  // Database rule violations (the triggers and checks in the schema) are the user's problem, not a crash.
  const code = (err as { code?: string }).code;
  if (code === "P0001" || code === "23514") {
    res.status(409).json({ error: (err as Error).message });
    return;
  }
  if (code === "23505") {
    res.status(409).json({ error: "That already exists." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Try again." });
}
