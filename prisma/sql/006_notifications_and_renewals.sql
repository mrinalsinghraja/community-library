-- ===========================================================================
-- Phase 4 — the two guarantees that are not in schema.prisma.
--
-- Kept here for the same reason as 005: a partial unique index cannot be
-- expressed in the Prisma schema, so it is invisible to `prisma migrate diff`
-- and to anybody reading the model file. Both of these ship in
-- prisma/migrations/20260817220000_phase4_notifications_and_renewal_requests.
--
-- **If `prisma migrate dev` ever regenerates that migration, both are lost.**
-- They are the mechanism, not an optimisation: without the first, a family gets
-- the same reminder every morning; without the second, a child pressing a
-- button twice opens two requests and a librarian answers a question nobody
-- asked twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. One reminder per loan, per due date, per occurrence.
--
--    The daily job claims a row before it hands anything to an email provider.
--    Two jobs running at the same instant both try to claim; one gets the row
--    and one gets a unique violation and moves on. That is the entire race
--    protection, and it lives in the database because a check-then-insert in
--    application code has a window between the two halves.
--
--    `due_at` is in the key deliberately. Renewing a loan moves its due date,
--    so every occurrence belonging to the old date is retired — the job derives
--    offsets from the loan's current due date and will never ask about the old
--    one again.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "loan_notification_occurrence_key"
    ON "loan_notification" ("loan_id", "due_at", "offset_days");

-- ---------------------------------------------------------------------------
-- 2. At most one PENDING renewal request per loan.
--
--    Partial on purpose: a loan may collect several decided requests over its
--    life, because asking again after a "not this time" is allowed and both
--    asks are part of what happened. Only one may be open.
--
--    This is also what makes concurrent submits safe. The service checks first
--    and gives a friendly sentence; this refuses the one that slips through.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "renewal_request_one_pending_per_loan"
    ON "renewal_request" ("loan_id")
 WHERE "status" = 'PENDING';
