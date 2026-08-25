-- Book reviews: one rating per reader per work, with an optional few words.
--
-- Keyed to book_title, not book_copy. A library with three copies of the same
-- book has one opinion of it per child, and the unique index below is what
-- stops a rating being inflated by borrowing the same book five times.

CREATE TYPE "ReviewAttribution" AS ENUM ('FIRST_NAME', 'ANONYMOUS');

CREATE TABLE "book_review" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "member_user_id" TEXT NOT NULL,
    "loan_id" TEXT,
    "rating" INTEGER NOT NULL,
    "review" TEXT,
    "attribution" "ReviewAttribution" NOT NULL DEFAULT 'FIRST_NAME',
    "hidden_at" TIMESTAMPTZ(6),
    "hidden_by_id" TEXT,
    "hidden_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "book_review_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "book_review_one_per_member_title"
    ON "book_review"("member_user_id", "title_id");

CREATE INDEX "book_review_library_id_title_id_idx" ON "book_review"("library_id", "title_id");
CREATE INDEX "book_review_library_id_hidden_at_idx" ON "book_review"("library_id", "hidden_at");
CREATE INDEX "book_review_member_user_id_created_at_idx" ON "book_review"("member_user_id", "created_at");

ALTER TABLE "book_review" ADD CONSTRAINT "book_review_library_id_fkey"
    FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_title_id_fkey"
    FOREIGN KEY ("title_id") REFERENCES "book_title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_member_user_id_fkey"
    FOREIGN KEY ("member_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_loan_id_fkey"
    FOREIGN KEY ("loan_id") REFERENCES "loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_hidden_by_id_fkey"
    FOREIGN KEY ("hidden_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Five stars, not four and a half and not zero. Enforced here as well as in Zod
-- so that a rating outside the scale cannot exist however it was written.
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_rating_range"
    CHECK ("rating" BETWEEN 1 AND 5);

-- One hundred words is the product rule; this is the character backstop that
-- goes with it, generous enough that a hundred long words still fit and tight
-- enough that nobody pastes an essay. Blank text is not a review — a rating
-- with no words stores NULL rather than an empty string.
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_length"
    CHECK ("review" IS NULL OR (length(btrim("review")) BETWEEN 1 AND 900));

-- A hidden review carries who hid it. The two columns move together or not at
-- all, so "taken down by nobody" cannot exist in the table.
ALTER TABLE "book_review" ADD CONSTRAINT "book_review_hidden_together"
    CHECK (("hidden_at" IS NULL) = ("hidden_by_id" IS NULL));
