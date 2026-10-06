-- Weeklies and monthlies are retired for evenings and specials: the old list of report kinds goes.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_kind_check;
