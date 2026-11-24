import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { requireAuth, requireRole } from "../auth.js";
import { handler, parse } from "../http.js";
import { createPerson } from "../people.js";
import { canAddPeople, MANAGER_ASSIGNABLE_ROLES } from "../rules.js";

/**
 * Managers and the CEO add the people on their team. They can create staff and client accounts only:
 * making someone a manager, CEO or administrator stays with an administrator, so no one can hand out more access than they have.
 */
export function peopleRoutes(ctx: AppContext) {
  const { db, env } = ctx;
  const r = Router();
  r.use(requireAuth(db, env.JWT_SECRET), requireRole(canAddPeople));

  const body = z.object({
    name: z.string().trim().min(1, "Add the person's name.").max(200),
    email: z.string().trim().toLowerCase().email("Add a valid email address."),
    jobTitle: z.string().trim().max(200).default(""),
    departmentId: z.string().nullable().default(null),
    appRole: z.enum(MANAGER_ASSIGNABLE_ROLES as unknown as [string, ...string[]]).default("staff"),
  });

  r.post(
    "/",
    handler(async (req, res) => {
      const b = parse(body, req.body);
      res.status(201).json(await createPerson(ctx, req.user!, { ...b, appRole: b.appRole as (typeof MANAGER_ASSIGNABLE_ROLES)[number] }));
    }),
  );

  return r;
}
