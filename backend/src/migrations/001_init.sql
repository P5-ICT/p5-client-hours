-- P5 Client Hours: initial schema.
-- Rules that protect the data live here, not only in the API, so a bug in a route cannot break them.

create table departments (
  id     text primary key,
  name   text not null unique,
  colour integer not null default 0
);

create table users (
  id                text primary key,
  email             text not null unique check (email = lower(email)),
  name              text not null,
  job_title         text not null default '',
  department_id     text references departments(id),
  app_role          text not null check (app_role in ('staff', 'manager', 'ceo', 'client', 'admin')),
  password_hash     text,
  -- A SHA-256 of the one-time token sent by email. Used for invites and password resets.
  token_hash        text unique,
  token_expires_at  timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table projects (
  id     text primary key,
  name   text not null unique,
  active boolean not null default true
);

create table work_types (
  name text primary key
);

-- One row only: the single client at launch. (The tables are keyed so more clients can be added later.)
create table settings (
  id            integer primary key default 1 check (id = 1),
  client_name   text not null,
  budget_hours  double precision not null check (budget_hours > 0),
  cycle_days    integer not null check (cycle_days between 1 and 62),
  cycle_anchor  text not null check (cycle_anchor ~ '^\d{4}-\d{2}-\d{2}$'),
  timezone      text not null default 'Africa/Johannesburg'
);

create table entries (
  id           text primary key,
  staff_id     text not null references users(id),
  project_id   text not null references projects(id),
  task         text not null,
  note         text not null check (char_length(btrim(note)) >= 5),
  proof        text not null default '',
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  minutes      integer not null check (minutes >= 1),
  method       text not null check (method in ('timer', 'manual')),
  manual_reason text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id  text references users(id),
  review_note  text not null default '',
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (ended_at > started_at),
  -- minutes is stored, but it must agree with the clock times.
  check (abs(minutes - extract(epoch from (ended_at - started_at)) / 60) < 1),
  check (method = 'timer' or char_length(btrim(manual_reason)) > 0),
  -- A reviewed entry has a reviewer, and nobody reviews their own hours.
  check (status = 'pending' or reviewer_id is not null),
  check (reviewer_id is null or reviewer_id <> staff_id),
  check (status <> 'rejected' or char_length(btrim(review_note)) > 0)
);

create index entries_started_at_idx on entries (started_at);
create index entries_staff_idx on entries (staff_id);
create index entries_status_idx on entries (status);

-- Approved and rejected entries are final: no edits, no deletes. A fix is a new entry.
create function entries_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'Reviewed entries cannot be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'pending' then
    raise exception 'Reviewed entries cannot be changed' using errcode = 'P0001';
  end if;
  -- Only the review fields may change on a pending entry.
  if new.staff_id <> old.staff_id or new.project_id <> old.project_id or new.task <> old.task
     or new.note <> old.note or new.proof <> old.proof or new.started_at <> old.started_at
     or new.ended_at <> old.ended_at or new.minutes <> old.minutes or new.method <> old.method
     or new.manual_reason <> old.manual_reason then
    raise exception 'Only the review fields of an entry can change' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger entries_guard_update before update on entries for each row execute function entries_guard();
create trigger entries_guard_delete before delete on entries for each row execute function entries_guard();

-- A new entry always starts as pending, whatever the caller asks for.
create function entries_force_pending() returns trigger language plpgsql as $$
begin
  new.status := 'pending';
  new.reviewer_id := null;
  new.reviewed_at := null;
  new.review_note := '';
  return new;
end $$;

create trigger entries_force_pending_insert before insert on entries for each row execute function entries_force_pending();

create table timers (
  staff_id    text primary key references users(id) on delete cascade,
  project_id  text not null references projects(id),
  task        text not null,
  note        text not null default '',
  proof       text not null default '',
  started_at  timestamptz not null,
  acc_ms      double precision not null default 0,
  running     boolean not null default true
);

-- Stops a threshold email from being sent twice for the same cycle.
create table alerts_sent (
  cycle_start text not null,
  threshold   integer not null check (threshold in (80, 100)),
  sent_at     timestamptz not null default now(),
  primary key (cycle_start, threshold)
);

create table audit_log (
  id        bigserial primary key,
  actor_id  text,
  action    text not null,
  entity    text not null,
  entity_id text,
  detail    jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);

create index audit_log_at_idx on audit_log (at desc);
