-- Changes from the team meeting:
--  * hours allocated to each department (for example marketing gets 8 of the 45)
--  * management can extend a cycle's hours
--  * management can log time on behalf of other people
--  * a minimum time a timer must run before it can be submitted

alter table departments add column allocated_hours double precision check (allocated_hours is null or allocated_hours >= 0);

alter table settings add column min_timer_minutes integer not null default 1 check (min_timer_minutes between 1 and 240);

-- Set when a manager typed the entry in for someone else. The person who logged it cannot also approve it.
alter table entries add column logged_by text references users(id);
alter table entries add constraint entries_logger_not_reviewer check (reviewer_id is null or logged_by is null or reviewer_id <> logged_by);

create or replace function entries_guard() returns trigger language plpgsql as $$
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
  if new.staff_id <> old.staff_id or new.project_id <> old.project_id or new.task <> old.task
     or new.note <> old.note or new.proof <> old.proof or new.started_at <> old.started_at
     or new.ended_at <> old.ended_at or new.minutes <> old.minutes or new.method <> old.method
     or new.manual_reason <> old.manual_reason or new.logged_by is distinct from old.logged_by then
    raise exception 'Only the review fields of an entry can change' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Extra hours added to one cycle, on top of the usual hours per cycle. Management only. Never edited, only added or removed.
create table hour_extensions (
  id          text primary key,
  cycle_start text not null check (cycle_start ~ '^\d{4}-\d{2}-\d{2}$'),
  hours       double precision not null check (hours > 0),
  reason      text not null check (char_length(btrim(reason)) > 0),
  created_by  text not null references users(id),
  created_at  timestamptz not null default now()
);

create index hour_extensions_cycle_idx on hour_extensions (cycle_start);
