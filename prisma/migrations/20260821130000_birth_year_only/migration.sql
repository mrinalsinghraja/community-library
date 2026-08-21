-- Children's dates of birth become years.
--
-- A free library in one apartment block needs one fact about a child's age:
-- are they roughly old enough. A full date of birth answers that and also hands
-- over one of the few fields that identify a person for life -- and it was
-- being typed into a public form by a parent. See ADR-051.
--
-- This migration is deliberately destructive. The year is copied out first and
-- the date is then dropped, so the precise birthday this library should never
-- have collected stops existing rather than sitting unused in a column.

ALTER TABLE "member_profile" ADD COLUMN "birth_year" INTEGER;
UPDATE "member_profile" SET "birth_year" = EXTRACT(YEAR FROM "date_of_birth")::int;
ALTER TABLE "member_profile" ALTER COLUMN "birth_year" SET NOT NULL;
ALTER TABLE "member_profile" DROP COLUMN "date_of_birth";

ALTER TABLE "registration_request" ADD COLUMN "child_birth_year" INTEGER;
UPDATE "registration_request" SET "child_birth_year" = EXTRACT(YEAR FROM "child_dob")::int;
ALTER TABLE "registration_request" ALTER COLUMN "child_birth_year" SET NOT NULL;
ALTER TABLE "registration_request" DROP COLUMN "child_dob";

-- Sanity only. The real range comes from the library's own ageMin/ageMax and is
-- enforced in the service, which is the only place that knows it.
ALTER TABLE "member_profile"
  ADD CONSTRAINT "member_profile_birth_year_plausible"
    CHECK ("birth_year" BETWEEN 1900 AND 2200);

ALTER TABLE "registration_request"
  ADD CONSTRAINT "registration_request_birth_year_plausible"
    CHECK ("child_birth_year" BETWEEN 1900 AND 2200);
