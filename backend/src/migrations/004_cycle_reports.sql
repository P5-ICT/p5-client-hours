-- One row per cycle whose summary has been emailed, so a daily job cannot send it twice.
create table cycle_reports (
  cycle_start text primary key,
  sent_at     timestamptz not null default now()
);

-- One row per person per day they were reminded about a timer left running.
create table timer_reminders (
  staff_id text not null references users(id) on delete cascade,
  on_day   text not null,
  sent_at  timestamptz not null default now(),
  primary key (staff_id, on_day)
);
