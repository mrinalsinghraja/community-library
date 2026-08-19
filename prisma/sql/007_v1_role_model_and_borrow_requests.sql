-- ===========================================================================
-- Version 1 — the guarantee behind borrow requests that is not in schema.prisma.
--
-- Kept here for the same reason as 005 and 006: a partial unique index cannot
-- be expressed in the Prisma schema, so it is invisible to `prisma migrate
-- diff` and to anybody reading the model file. It ships in
-- prisma/migrations/20260819000000_v1_role_model_and_borrow_requests.
--
-- **If `prisma migrate dev` ever regenerates that migration, it is lost.** It
-- is the mechanism, not an optimisation: without it, two children asking for
-- the same book in the same second both get a pending request, and a librarian
-- has to disappoint one of them for a reason the software created.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- One child at a time may be waiting for one physical book.
--
-- This is the entire queueing model. There are no holds, no waitlists and no
-- positions in a line: a copy either has somebody waiting on it or it does not.
-- A second asker is told the book is spoken for and can ask again later, which
-- is the truth, and is kinder than a number that says they are sixth.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "borrow_request_one_pending_per_copy"
    ON "borrow_request" ("copy_id")
 WHERE "status" = 'PENDING';
