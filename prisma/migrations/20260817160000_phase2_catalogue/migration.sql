-- ===========================================================================
-- Phase 2 — the catalogue.
--
-- Hand-finished from `prisma migrate diff`. Three places needed a human:
--
--   1. The CopyCondition enum loses two members and gains one. Prisma's
--      generated USING clause casts through text and would fail on every row
--      that says NEW or WORN, so the mapping is written out.
--   2. `book_title.age_group` is NOT NULL on a table that may already hold
--      rows. It is added nullable, backfilled from the old age_min/age_max
--      bounds, and only then tightened.
--   3. `book_title.category_id` becomes NOT NULL for the same reason, so any
--      unfiled title is moved onto the library's "Other" shelf, creating it if
--      the library does not have one yet.
--
-- Directory name: the timestamp must sort AFTER 20260817140000, because
-- migrations are applied in lexicographic order and the local clock does not
-- necessarily agree. See docs/DATABASE.md.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('AGE_5_7', 'AGE_8_10', 'AGE_11_14', 'ALL_AGES');

-- ---------------------------------------------------------------------------
-- AlterEnum: CopyCondition NEW/GOOD/FAIR/WORN -> GOOD/FAIR/DAMAGED
--
-- "New" is a claim about a book's history that nobody can verify a year later,
-- and "Worn" and "Damaged" were two words for the same shelf decision. Three
-- values a nine-year-old volunteer can apply consistently beat five nobody
-- applies the same way twice.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TYPE "CopyCondition_new" AS ENUM ('GOOD', 'FAIR', 'DAMAGED');
ALTER TABLE "public"."book_copy" ALTER COLUMN "condition" DROP DEFAULT;
ALTER TABLE "book_copy" ALTER COLUMN "condition" TYPE "CopyCondition_new"
  USING (
    CASE "condition"::text
      WHEN 'NEW'  THEN 'GOOD'
      WHEN 'WORN' THEN 'DAMAGED'
      ELSE "condition"::text
    END
  )::"CopyCondition_new";
ALTER TYPE "CopyCondition" RENAME TO "CopyCondition_old";
ALTER TYPE "CopyCondition_new" RENAME TO "CopyCondition";
DROP TYPE "public"."CopyCondition_old";
ALTER TABLE "book_copy" ALTER COLUMN "condition" SET DEFAULT 'GOOD';
COMMIT;

-- ---------------------------------------------------------------------------
-- book_title: drop the bibliographic metadata Version 1 deliberately does not
-- collect, and replace the free numeric age range with a shelf band.
--
-- ISBN, publisher, language and description are removed rather than left
-- unused: a nullable column nobody fills in is a field a future screen grows
-- back by accident. docs/CATALOGUE.md §2 records why each one is out of scope,
-- and re-adding any of them is a migration plus a decision, which is the right
-- price.
-- ---------------------------------------------------------------------------

-- DropIndex
DROP INDEX "book_title_library_id_isbn13_idx";

-- AlterTable: add the new column nullable so existing rows survive the step
ALTER TABLE "book_title" ADD COLUMN "age_group" "AgeGroup";

-- Backfill from the bounds we are about to drop. A range that spans the shelf
-- bands, or no range at all, becomes ALL_AGES — the honest answer when the old
-- data does not say.
UPDATE "book_title"
   SET "age_group" = CASE
     WHEN "age_max" IS NOT NULL AND "age_max" <= 7  THEN 'AGE_5_7'
     WHEN "age_max" IS NOT NULL AND "age_max" <= 10 THEN 'AGE_8_10'
     WHEN "age_min" IS NOT NULL AND "age_min" >= 11 THEN 'AGE_11_14'
     ELSE 'ALL_AGES'
   END::"AgeGroup"
 WHERE "age_group" IS NULL;

ALTER TABLE "book_title" ALTER COLUMN "age_group" SET NOT NULL;

-- Every title is filed on a shelf. Unfiled ones move to "Other", which is
-- created for the library if the seed has not yet done so.
INSERT INTO "book_category" ("id", "library_id", "name", "slug", "icon", "sort_order", "is_active")
SELECT gen_random_uuid()::text, l."id", 'Other', 'other', '📚', 70, true
  FROM "library" l
 WHERE EXISTS (
         SELECT 1 FROM "book_title" t
          WHERE t."library_id" = l."id" AND t."category_id" IS NULL
       )
   AND NOT EXISTS (
         SELECT 1 FROM "book_category" c
          WHERE c."library_id" = l."id" AND c."slug" = 'other'
       );

UPDATE "book_title" t
   SET "category_id" = c."id"
  FROM "book_category" c
 WHERE t."category_id" IS NULL
   AND c."library_id" = t."library_id"
   AND c."slug" = 'other';

-- DropForeignKey (recreated below as RESTRICT: a shelf with books on it cannot
-- be deleted out from under them)
ALTER TABLE "book_title" DROP CONSTRAINT "book_title_category_id_fkey";

-- AlterTable
ALTER TABLE "book_title" DROP COLUMN "age_max",
DROP COLUMN "age_min",
DROP COLUMN "description",
DROP COLUMN "isbn10",
DROP COLUMN "isbn13",
DROP COLUMN "language",
DROP COLUMN "publisher",
ALTER COLUMN "category_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "book_copy_library_id_condition_idx" ON "book_copy"("library_id", "condition");

-- CreateIndex
CREATE INDEX "book_title_library_id_age_group_idx" ON "book_title"("library_id", "age_group");

-- AddForeignKey
ALTER TABLE "book_title" ADD CONSTRAINT "book_title_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "book_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Raw SQL: prisma/sql/004_catalogue.sql
--
-- Kept verbatim below so that `prisma migrate deploy` alone builds the whole
-- database. The file is the readable source; this is the applied copy.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A book has a title and at least one author, and neither is whitespace.
-- ---------------------------------------------------------------------------
ALTER TABLE book_title
  ADD CONSTRAINT book_title_has_title
    CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  ADD CONSTRAINT book_title_has_author
    CHECK (
      array_length(authors, 1) >= 1
      AND btrim(array_to_string(authors, '')) <> ''
    );

-- ---------------------------------------------------------------------------
-- 2. Archiving is a real event with a real timestamp, in both directions.
-- ---------------------------------------------------------------------------
ALTER TABLE book_copy
  ADD CONSTRAINT book_copy_archived_has_timestamp
    CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
  ADD CONSTRAINT book_copy_code_present
    CHECK (btrim(copy_code) <> '');

-- ---------------------------------------------------------------------------
-- 3. A donation credits somebody, and carries no way to contact them.
-- ---------------------------------------------------------------------------
ALTER TABLE donation
  ADD CONSTRAINT donation_donor_name_present
    CHECK (btrim(donor_name) <> '' AND char_length(donor_name) <= 120),
  ADD CONSTRAINT donation_apartment_is_short
    CHECK (donor_apartment IS NULL OR char_length(btrim(donor_apartment)) BETWEEN 1 AND 20),
  ADD CONSTRAINT donation_not_in_the_future
    CHECK (donated_at <= CURRENT_DATE + 1);

-- ---------------------------------------------------------------------------
-- 4. Partial author search. Expression-based, so `prisma migrate dev` cannot
--    introspect it and therefore cannot drop it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION book_title_authors_text(p_authors text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT lower(coalesce(array_to_string(p_authors, ' '), ''));
$$;

CREATE INDEX book_title_authors_trgm_idx
  ON book_title
  USING gin (book_title_authors_text(authors) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. The browse index: everything not archived, newest first.
-- ---------------------------------------------------------------------------
CREATE INDEX book_copy_on_shelf_idx
  ON book_copy (library_id, created_at DESC)
  WHERE status <> 'ARCHIVED';
