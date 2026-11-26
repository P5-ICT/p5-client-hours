-- The shortest timer that can be submitted is now 15 minutes. An administrator can change it under Team and settings.
alter table settings alter column min_timer_minutes set default 15;
update settings set min_timer_minutes = 15;
