-- Retention periods. All nullable, all unset on purpose: NULL means "keep
-- indefinitely", which is what this library already does. Nothing is erased
-- until a Super Admin decides a number on the settings screen.
--
-- Additive only. No column is dropped and no row is touched.
ALTER TABLE "library_settings"
  ADD COLUMN "archive_closed_after_months"    INTEGER,
  ADD COLUMN "remove_photo_after_closed_days" INTEGER,
  ADD COLUMN "remove_guardian_after_months"   INTEGER;
