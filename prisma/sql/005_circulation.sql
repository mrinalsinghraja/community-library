-- ===========================================================================
-- Phase 3 — circulation's guarantees, in the database.
--
-- Theme: there is one physical book, and at any moment it is either on the
-- shelf or in one child's bag. The application knows that. This file is what
-- makes it true even when the application is wrong, raced, or bypassed by
-- somebody with a psql prompt.
--
-- The single most important rule is the one Postgres cannot express as a CHECK,
-- because it spans two tables:
--
--     a copy reads BORROWED  <=>  that copy has exactly one ACTIVE loan
--
-- Everything else here is supporting work.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A loan's closing fields must match its status.
--
--    Replaces loan_return_fields_match_status from 001, which allowed the LOST
--    and WRITTEN_OFF statuses that Phase 3 removed. Now there are three states
--    and each one says exactly which timestamp must be present — so "returned
--    but we do not know when" and "cancelled and also returned" are both
--    unrepresentable rather than merely unlikely.
-- ---------------------------------------------------------------------------
ALTER TABLE loan DROP CONSTRAINT IF EXISTS loan_return_fields_match_status;

ALTER TABLE loan
  ADD CONSTRAINT loan_closing_fields_match_status
    CHECK (
      (status = 'ACTIVE'    AND returned_at IS NULL     AND cancelled_at IS NULL)
      OR (status = 'RETURNED'  AND returned_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND returned_at IS NULL)
    ),
  ADD CONSTRAINT loan_cancelled_after_issue
    CHECK (cancelled_at IS NULL OR cancelled_at >= issued_at);

-- ---------------------------------------------------------------------------
-- 2. Loan events are history, so they must say something true.
--
--    A RENEW event exists to record a date moving. One that does not carry both
--    the old date and the new one is not a record of anything, and the child's
--    original due date would be lost — which is the one thing renewal must not
--    do. `new_due_at > previous_due_at` because renewing is extending; a
--    renewal that shortened a loan would be a correction wearing a disguise.
-- ---------------------------------------------------------------------------
ALTER TABLE loan_event
  ADD CONSTRAINT loan_event_renewal_moves_the_date
    CHECK (
      type <> 'RENEW'
      OR (previous_due_at IS NOT NULL AND new_due_at IS NOT NULL AND new_due_at > previous_due_at)
    ),
  -- The note is a sentence a librarian typed, not a document store.
  ADD CONSTRAINT loan_event_note_is_short
    CHECK (note IS NULL OR char_length(note) <= 500);

-- ---------------------------------------------------------------------------
-- 3. The invariant: a borrowed book has a borrower, and a borrower's book
--    reads borrowed.
--
--    Why a trigger and not a CHECK: a CHECK constraint may only look at the row
--    it is checking. This rule is about a `book_copy` row and a `loan` row
--    agreeing, so it has to be able to read across.
--
--    Why a CONSTRAINT trigger, DEFERRABLE INITIALLY DEFERRED: issuing a book
--    creates a loan and updates a copy, and one of those necessarily happens
--    first. An immediate trigger would reject the perfectly correct transaction
--    halfway through. Deferring the check to COMMIT means the rule is applied
--    to the *end state* — which is the state that matters — while still being
--    impossible to escape, because a transaction that would leave the database
--    incoherent simply does not commit.
--
--    Consequence worth knowing: a violation surfaces at commit, not at the
--    offending statement. The services check first and raise something a
--    librarian can read; this is the net underneath them, not the first line.
-- ---------------------------------------------------------------------------

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

  -- The copy no longer exists — a library being deleted, cascading through
  -- both tables. There is nothing left to be incoherent about.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_active
    FROM loan
   WHERE copy_id = p_copy_id
     AND status = 'ACTIVE';

  -- Belt and braces behind the one_active_loan_per_copy unique index. If that
  -- index is ever dropped by a careless migration, this still holds.
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

/*
 * Two thin wrappers rather than one clever one. A single function switching on
 * TG_TABLE_NAME would need dynamic SQL to reach a differently-named column, and
 * dynamic SQL inside a constraint trigger is not where anybody wants to be
 * debugging a failed issue at a busy desk.
 */
CREATE OR REPLACE FUNCTION circulation_loan_keeps_copy_coherent()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  -- A loan that moved between copies has to leave both of them coherent.
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

-- ---------------------------------------------------------------------------
-- 4. The overdue index.
--
--    "Which books are late?" is the query the desk runs most often and the one
--    that has to stay fast as history accumulates: after five years, active
--    loans are a rounding error next to returned ones. Partial, so the index
--    only ever contains books that are actually out.
--
--    Partial on purpose in a second sense: `prisma migrate dev` drops raw
--    indexes it can introspect but cannot find in schema.prisma. It cannot
--    express a WHERE clause, so it leaves this alone — the same defence as the
--    expression indexes in 004. See docs/DATABASE.md.
-- ---------------------------------------------------------------------------
CREATE INDEX loan_active_by_due_date_idx
  ON loan (library_id, due_at)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 5. Finding the child at the desk.
--
--    A librarian with a queue in front of them types three letters of a name or
--    a card number. The name side needs an index on the exact expression the
--    query uses, or Postgres cannot use one at all.
--
--    The card-number side needs nothing new: 001 already built
--    `member_profile_code_lower_idx ON member_profile (library_id,
--    lower(member_code))`, which is the same expression and better scoped. A
--    second index on `lower(member_code)` alone was written here and then
--    removed — it duplicated work and collided by name on a clean install,
--    which is what verifying the migration against an empty database is for.
--
--    Note what is NOT indexed for search: apartment. Finding children by which
--    flat they live in is not a lookup this application offers — see
--    docs/SECURITY.md.
-- ---------------------------------------------------------------------------
CREATE INDEX app_user_display_name_trgm_idx
  ON app_user
  USING gin (lower(display_name) gin_trgm_ops);
