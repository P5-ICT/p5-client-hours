-- Makes signed-in sessions revocable, and slows down password guessing.

-- Bumped whenever a password changes. The number is carried in the session token, so every
-- token issued before the change stops working at once instead of lasting out its 12 hours.
alter table users add column session_epoch integer not null default 0;

-- Counted per account, so guessing cannot be spread across many IP addresses to dodge the
-- per-IP rate limit. Cleared on a successful sign-in.
alter table users add column failed_logins integer not null default 0;
alter table users add column locked_until timestamptz;
