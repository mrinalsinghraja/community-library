-- ===========================================================================
-- Phase 3 — circulation.
--
-- Hand-corrected after `prisma migrate diff`. Three things needed a human:
--
--   1. **Existing BORROWED copies stop the migration.** Phase 2 let a librarian
--      pick "Borrowed" as a status, so a database upgraded from it may hold
--      copies that read BORROWED with no loan and therefore no borrower.
--      Step 0 below refuses to continue while any such copy exists.
--
--      It deliberately does NOT repair them. Both repairs are lies a deployment
--      is not entitled to tell:
--
--        * Resetting to AVAILABLE says the book is on the shelf. It may be in a
--          child's bag, and the next reader would be promised a book nobody can
--          hand them.
--        * Creating a loan says a particular child has it. Nothing in the
--          database knows who, and a fabricated borrower would sit in a real
--          child's borrowing history forever.
--
--      A person has to walk to the shelf. Which copies, and the three
--      resolutions open to them, are in docs/OPERATIONS.md — "An inconsistent
--      circulation state". The function installed here is the same one they run
--      to check their work.
--
--      This must run before step 5 installs the trigger, or the trigger's first
--      encounter with one of those rows would be a failure at a busy desk.
--
--   2. **Two things that reference `loan.status` had to be taken down first.**
--
--      The CHECK constraint `loan_return_fields_match_status` names 'LOST' and
--      'WRITTEN_OFF' literally, and altering the column's type re-parses that
--      expression against the new enum, which no longer has those values.
--
--      The partial unique index `one_active_loan_per_copy` is the subtler one.
--      Its predicate is `WHERE status = 'ACTIVE'::"LoanStatus"`, and Postgres
--      rebuilds indexes when a column's type changes — but by then the column
--      is `LoanStatus_new` while the predicate still says `LoanStatus`:
--
--          ERROR: operator does not exist: "LoanStatus_new" = "LoanStatus"
--
--      Prisma's generated SQL cannot know about it, because a partial index is
--      not expressible in schema.prisma and never appears there. It is dropped
--      and rebuilt around the enum swap below. **It is the guarantee that a
--      book cannot be issued twice, so it is rebuilt in the same migration —
--      never left for a later one.**
--
--   3. **The cross-table invariant is a constraint trigger**, not a CHECK,
--      because it is about two tables agreeing. See prisma/sql/005_circulation.sql
--      for why it is DEFERRABLE.
--
-- Nothing here drops a loan or a loan event. There are none yet, and if there
-- were, they would be the library's own record of what happened.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Refuse to migrate a library whose shelves and records disagree.
--
--    On a database with no such copy this installs a function and does nothing
--    else, which is every clean install and every library that never used the
--    Phase 2 "Borrowed" status. On one that does have such a copy, the whole
--    migration stops here having changed nothing but the presence of this
--    function — Prisma applies statements in order, so nothing below has run.
--
--    The function stays behind on purpose. An operator runs
--    `SELECT circulation_assert_no_stranded_copies();` to see the list, and
--    runs it again after resolving each one to confirm they are done.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION circulation_assert_no_stranded_copies()
  RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  v_codes text;
  v_count integer;
BEGIN
  SELECT count(*), string_agg(c.copy_code, ', ' ORDER BY c.copy_code)
    INTO v_count, v_codes
    FROM book_copy c
   WHERE c.status = 'BORROWED'
     AND NOT EXISTS (
       SELECT 1 FROM loan l WHERE l.copy_id = c.id AND l.status = 'ACTIVE'
     );

  IF v_count = 0 THEN
    RETURN;
  END IF;

  RAISE EXCEPTION
    'Cannot enable circulation: % book(s) read BORROWED with no loan and so no borrower (%). Someone must find out where each one is; a deployment must not guess. See docs/OPERATIONS.md, "An inconsistent circulation state".',
    v_count, v_codes
    USING ERRCODE = 'raise_exception';
END;
$$;

SELECT circulation_assert_no_stranded_copies();

-- ---------------------------------------------------------------------------
-- 2. Take down what depends on the old enum. Both come back below.
-- ---------------------------------------------------------------------------
ALTER TABLE "loan" DROP CONSTRAINT IF EXISTS "loan_return_fields_match_status";
DROP INDEX IF EXISTS one_active_loan_per_copy;

-- ---------------------------------------------------------------------------
-- 3. The enums. Generated by `prisma migrate diff`, read before applying.
--
--    Safe to rebuild rather than rename: no row anywhere uses LOST,
--    WRITTEN_OFF, MARK_LOST or ADJUST_DUE, because no loan has ever been
--    issued. If that were not true this would be an ALTER TYPE ... RENAME
--    VALUE, as migration 2 was for consent.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TYPE "LoanEventType_new" AS ENUM ('ISSUE', 'RENEW', 'RETURN', 'CANCEL', 'MARK_DAMAGED', 'CORRECT');
ALTER TABLE "loan_event" ALTER COLUMN "type" TYPE "LoanEventType_new" USING ("type"::text::"LoanEventType_new");
ALTER TYPE "LoanEventType" RENAME TO "LoanEventType_old";
ALTER TYPE "LoanEventType_new" RENAME TO "LoanEventType";
DROP TYPE "public"."LoanEventType_old";
COMMIT;

BEGIN;
CREATE TYPE "LoanStatus_new" AS ENUM ('ACTIVE', 'RETURNED', 'CANCELLED');
ALTER TABLE "public"."loan" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "loan" ALTER COLUMN "status" TYPE "LoanStatus_new" USING ("status"::text::"LoanStatus_new");
ALTER TYPE "LoanStatus" RENAME TO "LoanStatus_old";
ALTER TYPE "LoanStatus_new" RENAME TO "LoanStatus";
DROP TYPE "public"."LoanStatus_old";
ALTER TABLE "loan" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- Back up immediately. This index is the last line of defence against handing
-- the same physical book to two children, and the window in which it does not
-- exist should be as short as this file can make it.
CREATE UNIQUE INDEX one_active_loan_per_copy
  ON loan (copy_id)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 4. Columns.
--
--    A cancelled loan has to be able to say when it was cancelled and by whom.
--    `allow_renewal_when_overdue` defaults to false, which is the policy: a
--    book past its date comes to the desk and is returned, and may go straight
--    back out the same minute. A community that prefers otherwise changes one
--    row rather than a line of code.
-- ---------------------------------------------------------------------------
ALTER TABLE "library_settings" ADD COLUMN "allow_renewal_when_overdue" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "loan" ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
                  ADD COLUMN "cancelled_by_id" TEXT;

ALTER TABLE "loan" ADD CONSTRAINT "loan_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Everything Prisma's schema language cannot say.
--    Kept verbatim in prisma/sql/005_circulation.sql for the record.
-- ---------------------------------------------------------------------------

ALTER TABLE loan
  ADD CONSTRAINT loan_closing_fields_match_status
    CHECK (
      (status = 'ACTIVE'    AND returned_at IS NULL     AND cancelled_at IS NULL)
      OR (status = 'RETURNED'  AND returned_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND returned_at IS NULL)
    ),
  ADD CONSTRAINT loan_cancelled_after_issue
    CHECK (cancelled_at IS NULL OR cancelled_at >= issued_at);

ALTER TABLE loan_event
  ADD CONSTRAINT loan_event_renewal_moves_the_date
    CHECK (
      type <> 'RENEW'
      OR (previous_due_at IS NOT NULL AND new_due_at IS NOT NULL AND new_due_at > previous_due_at)
    ),
  ADD CONSTRAINT loan_event_note_is_short
    CHECK (note IS NULL OR char_length(note) <= 500);

CREATE OR REPLACE FUNCTION circulation_assert_copy_coherent(p_copy_id text)
  RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_code   text;
  v_active integer;
BEGIN
  SELECT status::text, copy_code
    INTO v_status, v_code
    FROM book_copy
   WHERE id = p_copy_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_active
    FROM loan
   WHERE copy_id = p_copy_id
     AND status = 'ACTIVE';

  IF v_active > 1 THEN
    RAISE EXCEPTION
      'Book % has % active loans; one physical book cannot be in two pairs of hands',
      v_code, v_active
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_active = 1 AND v_status <> 'BORROWED' THEN
    RAISE EXCEPTION
      'Book % is on loan but reads %; a book somebody has must read BORROWED',
      v_code, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_active = 0 AND v_status = 'BORROWED' THEN
    RAISE EXCEPTION
      'Book % reads BORROWED but has no active loan; a borrowed book must have a borrower',
      v_code
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION circulation_loan_keeps_copy_coherent()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM circulation_assert_copy_coherent(OLD.copy_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM circulation_assert_copy_coherent(NEW.copy_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION circulation_copy_matches_its_loan()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM circulation_assert_copy_coherent(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS loan_keeps_copy_coherent ON loan;
CREATE CONSTRAINT TRIGGER loan_keeps_copy_coherent
  AFTER INSERT OR UPDATE OR DELETE ON loan
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION circulation_loan_keeps_copy_coherent();

DROP TRIGGER IF EXISTS copy_status_matches_its_loan ON book_copy;
CREATE CONSTRAINT TRIGGER copy_status_matches_its_loan
  AFTER INSERT OR UPDATE ON book_copy
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION circulation_copy_matches_its_loan();

CREATE INDEX loan_active_by_due_date_idx
  ON loan (library_id, due_at)
  WHERE status = 'ACTIVE';

-- Card-number search already has its index from migration 1
-- (member_profile_code_lower_idx). Only the name side is new.
CREATE INDEX app_user_display_name_trgm_idx
  ON app_user
  USING gin (lower(display_name) gin_trgm_ops);
