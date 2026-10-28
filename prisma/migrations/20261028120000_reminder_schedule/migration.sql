-- Reminder schedule, October 2026 (owner's decision): a week before the due
-- date, the day before, then weekly after it (the weekly part is code, not
-- configuration). Libraries still on the old default move to the new one; a
-- library that chose its own offsets keeps them.
ALTER TABLE "library_settings" ALTER COLUMN "overdue_reminder_offsets" SET DEFAULT ARRAY[-7, -1]::INTEGER[];

UPDATE "library_settings"
   SET "overdue_reminder_offsets" = ARRAY[-7, -1]::INTEGER[]
 WHERE "overdue_reminder_offsets" = ARRAY[-2, 0, 3, 7]::INTEGER[];
