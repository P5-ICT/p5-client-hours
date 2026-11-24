import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `staff`   log their own time.
 * `manager` approve time for their client, but never their own entries.
 * `ceo`     sees everything and may approve.
 * `client`  reads only approved entries for their own client.
 * `admin`   manages people, projects and settings.
 */
export const appRole = pgEnum("app_role", ["staff", "manager", "ceo", "client", "admin"]);
export const entryStatus = pgEnum("entry_status", ["pending", "approved", "rejected"]);
export const entryMethod = pgEnum("entry_method", ["timer", "manual"]);
export const tokenPurpose = pgEnum("token_purpose", ["invite", "reset"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Organisation ----------

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull(),
  /** Paid hours per cycle, stored as minutes so no rounding is lost. */
  budgetMinutes: integer("budget_minutes").notNull().default(45 * 60),
  cycleDays: integer("cycle_days").notNull().default(14),
  /** First day of a cycle; every later cycle is counted from here. */
  cycleAnchor: date("cycle_anchor").notNull(),
  /** Cycle boundaries and "today" are resolved in this zone, not UTC. */
  timezone: text("timezone").notNull().default("Africa/Johannesburg"),
  /** When false the client report link stops working, without deleting history. */
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  check("clients_budget_positive", sql`${t.budgetMinutes} > 0`),
  check("clients_cycle_days_range", sql`${t.cycleDays} between 1 and 62`),
]);

export const departments = pgTable("departments", {
  id: id(),
  name: text("name").notNull(),
  /** Index into the department colour palette in the UI. */
  colorIndex: integer("color_index").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("departments_name_key").on(sql`lower(${t.name})`)]);

export const projects = pgTable("projects", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("projects_client_idx").on(t.clientId)]);

export const workTypes = pgTable("work_types", {
  id: id(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("work_types_name_key").on(sql`lower(${t.name})`)]);

// ---------- People and auth ----------

export const users = pgTable("users", {
  id: id(),
  /** Always stored lower-cased; the unique index is what stops duplicate sign-ups. */
  email: text("email").notNull(),
  /** Null until the invite is accepted, so an invited person cannot sign in yet. */
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  /** Job title shown in reports, e.g. "Software Developer". */
  jobTitle: text("job_title").notNull().default(""),
  appRole: appRole("app_role").notNull().default("staff"),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  /** Set for client users only: the client whose report they may read. */
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** Counts failed sign-ins since the last success, to slow down guessing. */
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
  index("users_role_idx").on(t.appRole),
  // A client user is meaningless without a client to read.
  check("users_client_has_client_id", sql`${t.appRole} <> 'client' or ${t.clientId} is not null`),
]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** SHA-256 of the cookie value. The raw token is never stored. */
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("sessions_token_key").on(t.tokenHash),
  index("sessions_user_idx").on(t.userId),
  index("sessions_expiry_idx").on(t.expiresAt),
]);

/** One-time links for invites and password resets. */
export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  purpose: tokenPurpose("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("auth_tokens_token_key").on(t.tokenHash),
  index("auth_tokens_user_idx").on(t.userId),
]);

// ---------- Time ----------

export const timeEntries = pgTable("time_entries", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "restrict" }),
  workType: text("work_type").notNull(),
  note: text("note").notNull(),
  proofUrl: text("proof_url").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  /** Kept in step with started_at/ended_at by the check below. */
  minutes: integer("minutes").notNull(),
  method: entryMethod("method").notNull(),
  manualReason: text("manual_reason").notNull().default(""),
  status: entryStatus("status").notNull().default("pending"),
  reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  reviewNote: text("review_note").notNull().default(""),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("time_entries_client_start_idx").on(t.clientId, t.startedAt),
  index("time_entries_staff_idx").on(t.staffId),
  index("time_entries_status_idx").on(t.status),
  check("time_entries_end_after_start", sql`${t.endedAt} > ${t.startedAt}`),
  check("time_entries_minutes_positive", sql`${t.minutes} > 0`),
  check(
    "time_entries_minutes_match",
    sql`${t.minutes} = round(extract(epoch from (${t.endedAt} - ${t.startedAt})) / 60)`,
  ),
  check("time_entries_note_length", sql`char_length(btrim(${t.note})) >= 5`),
  // A typed-in entry must say why the timer was not used.
  check(
    "time_entries_manual_reason",
    sql`${t.method} <> 'manual' or char_length(btrim(${t.manualReason})) > 0`,
  ),
  // A rejected entry must say why.
  check(
    "time_entries_reject_reason",
    sql`${t.status} <> 'rejected' or char_length(btrim(${t.reviewNote})) > 0`,
  ),
  // Reviewed entries must record who reviewed them and when.
  check(
    "time_entries_reviewed_fields",
    sql`${t.status} = 'pending' or (${t.reviewerId} is not null and ${t.reviewedAt} is not null)`,
  ),
  // Nobody may approve or reject their own work. The last line of defence.
  check("time_entries_no_self_review", sql`${t.reviewerId} is null or ${t.reviewerId} <> ${t.staffId}`),
  // Proof links are rendered as anchors, so only web links are allowed.
  check("time_entries_proof_scheme", sql`${t.proofUrl} = '' or ${t.proofUrl} ~* '^https?://'`),
]);

/** At most one running timer per person, which is why staff_id is the primary key. */
export const runningTimers = pgTable("running_timers", {
  staffId: uuid("staff_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workType: text("work_type").notNull(),
  note: text("note").notNull().default(""),
  proofUrl: text("proof_url").notNull().default(""),
  /** When the current run started. Only meaningful while `running` is true. */
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  /** Milliseconds banked by earlier runs before the latest pause. */
  accumulatedMs: integer("accumulated_ms").notNull().default(0),
  running: boolean("running").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("running_timers_accumulated_positive", sql`${t.accumulatedMs} >= 0`)]);

/** One row per threshold per cycle, so an alert email is never sent twice. */
export const alertsSent = pgTable("alerts_sent", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  cycleStart: date("cycle_start").notNull(),
  threshold: integer("threshold").notNull(),
  sentAt: createdAt(),
}, (t) => [
  uniqueIndex("alerts_sent_key").on(t.clientId, t.cycleStart, t.threshold),
]);

export const auditLog = pgTable("audit_log", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  at: createdAt(),
}, (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_entity_idx").on(t.entity, t.entityId)]);

// ---------- Relations ----------

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  client: one(clients, { fields: [users.clientId], references: [clients.id] }),
  entries: many(timeEntries),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  staff: one(users, { fields: [timeEntries.staffId], references: [users.id], relationName: "entryStaff" }),
  reviewer: one(users, { fields: [timeEntries.reviewerId], references: [users.id], relationName: "entryReviewer" }),
  project: one(projects, { fields: [timeEntries.projectId], references: [projects.id] }),
  client: one(clients, { fields: [timeEntries.clientId], references: [clients.id] }),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type TimeEntryRow = typeof timeEntries.$inferSelect;
export type RunningTimerRow = typeof runningTimers.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type AppRole = (typeof appRole.enumValues)[number];
