-- The AI Librarian's current suggestion for one reader.
--
-- One row per reader, replaced in place rather than appended to: this table
-- holds what is being suggested now, never a history of what a child has been
-- steered towards. The unique constraint on member_user_id is what enforces it.
--
-- Cascade on both foreign keys. A reader who is genuinely deleted — a test
-- account, or one created by mistake — takes their suggestion with them. Closed
-- accounts (GROWN_UP, LEFT) are not deleted and keep theirs, which costs
-- nothing and is never rendered because a closed account cannot sign in.
CREATE TABLE "reader_recommendation" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "member_user_id" TEXT NOT NULL,
    "picks" JSONB NOT NULL,
    "basis" TEXT NOT NULL,
    "history_signature" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reader_recommendation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reader_recommendation_member_user_id_key"
    ON "reader_recommendation"("member_user_id");

CREATE INDEX "reader_recommendation_library_id_generated_at_idx"
    ON "reader_recommendation"("library_id", "generated_at");

ALTER TABLE "reader_recommendation"
    ADD CONSTRAINT "reader_recommendation_library_id_fkey"
    FOREIGN KEY ("library_id") REFERENCES "library"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reader_recommendation"
    ADD CONSTRAINT "reader_recommendation_member_user_id_fkey"
    FOREIGN KEY ("member_user_id") REFERENCES "app_user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
