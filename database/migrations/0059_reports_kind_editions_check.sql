-- The report kinds now: a daily and an evening each cover half a day, a special tells one topic.
-- Checked for new rows; old weeklies and monthlies are deleted by hand (docs/deploy.md).
ALTER TABLE reports ADD CONSTRAINT reports_kind_editions_check CHECK (kind IN ('daily', 'evening', 'special')) NOT VALID;
