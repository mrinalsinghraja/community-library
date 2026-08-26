-- A reader telling the library they are bringing a book back.
--
-- A notice, not a return: the loan stays ACTIVE and the copy stays BORROWED
-- until a librarian records the return with the book in their hands. Both
-- columns are nullable and no existing row is touched.
ALTER TABLE "loan"
  ADD COLUMN "return_announced_at"    TIMESTAMPTZ(6),
  ADD COLUMN "return_announced_by_id" TEXT;

ALTER TABLE "loan"
  ADD CONSTRAINT "loan_return_announced_by_id_fkey"
  FOREIGN KEY ("return_announced_by_id") REFERENCES "app_user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Only announced loans are ever queried this way, so the index carries only
-- those rows rather than one entry per loan the library has ever made.
CREATE INDEX "loan_library_id_return_announced_at_idx"
  ON "loan" ("library_id", "return_announced_at")
  WHERE "return_announced_at" IS NOT NULL;
