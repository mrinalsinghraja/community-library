-- Reviews are approved before they are published, not taken down afterwards.
--
-- Reverses the post-moderation design of migration 12 (ADR-057) at the owner's
-- decision. See ADR-058.

CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

ALTER TABLE "book_review"
    ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "decided_at" TIMESTAMPTZ(6),
    ADD COLUMN "decided_by_id" TEXT,
    ADD COLUMN "decision_note" TEXT;

-- Reviews written under the old rules were already on the shelf. They keep the
-- state they actually had rather than being demoted into a queue: a review a
-- child could read yesterday must not vanish because the rules changed today.
-- A review a librarian had taken down becomes REJECTED, which is the same
-- outcome by the new vocabulary.
--
-- `decided_at` is backfilled from `created_at` and `decided_by_id` is left NULL,
-- which is the honest record: nobody decided these. The old rules published them
-- the moment they were written, and inventing an approver would put a
-- librarian's name against a decision they never made.
UPDATE "book_review"
   SET "status" = 'PUBLISHED',
       "decided_at" = "created_at"
 WHERE "hidden_at" IS NULL;
UPDATE "book_review"
   SET "status" = 'REJECTED',
       "decided_at" = "hidden_at",
       "decided_by_id" = "hidden_by_id",
       "decision_note" = "hidden_reason"
 WHERE "hidden_at" IS NOT NULL;

ALTER TABLE "book_review" DROP CONSTRAINT IF EXISTS "book_review_hidden_together";
ALTER TABLE "book_review" DROP CONSTRAINT IF EXISTS "book_review_hidden_by_id_fkey";
DROP INDEX IF EXISTS "book_review_library_id_hidden_at_idx";

ALTER TABLE "book_review"
    DROP COLUMN "hidden_at",
    DROP COLUMN "hidden_by_id",
    DROP COLUMN "hidden_reason";

CREATE INDEX "book_review_library_id_status_idx" ON "book_review"("library_id", "status");

ALTER TABLE "book_review" ADD CONSTRAINT "book_review_decided_by_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A decided review carries when it was decided. PENDING carries neither.
-- `decided_by_id` is deliberately NOT in this check: the deciding staff account
-- can be deleted later, which SetNulls the column, and that must not turn a
-- published review into a row the database refuses to hold.
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_decision_timing"
    CHECK (("status" = 'PENDING') = ("decided_at" IS NULL));
