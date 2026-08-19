-- ===========================================================================
-- Version 1 — three roles, and a child asking for a book.
--
-- Two changes that belong together, because both are about the same question:
-- who is allowed to decide something.
--
--   1. **The role model is locked to three assignable roles**: Super Admin,
--      Librarian, Reader. JUNIOR_LIBRARIAN was already seeded dormant; GUARDIAN
--      joins it, because a guardian is somebody the library writes to, recorded
--      on a child's registration — never an account that signs in. Nothing has
--      ever granted it, so nobody loses anything.
--
--      Two permissions move off Librarian and stay with the Super Admin:
--      `registration.review`, so no child's application is approved or refused
--      except by the owner of the library, and `member.deactivate`, so closing
--      a family's membership is not a click at the desk. A librarian keeps
--      everything reversible: adding books, editing them, archiving a copy,
--      suspending a reader, issuing, returning, renewing.
--
--   2. **Borrow requests.** A child can now ask for a book from the catalogue.
--      The request moves nothing. The copy stays AVAILABLE, no loan exists and
--      no due date is set until a librarian approves it — at which point the
--      approval runs the desk's own issue code, with the desk's own rules.
--
-- Nothing here deletes a person, a loan, a book or a registration. The revoked
-- grants are rows in role_permission, which the seed re-derives from
-- src/lib/permissions.ts on every run; borrow_request starts empty, which
-- correctly means no child has asked for anything yet.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Refuse to build the index over data that contradicts it.
--
--    On every real database this does nothing: the table is being created two
--    statements below. It is here so that a re-run against a database somebody
--    has already written to cannot silently discard a child's request in order
--    to make an index build.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_count integer; v_copies text;
BEGIN
  IF to_regclass('public.borrow_request') IS NULL THEN RETURN; END IF;

  SELECT count(*), string_agg(copy_id, ', ' ORDER BY copy_id)
    INTO v_count, v_copies
    FROM (
      SELECT copy_id
        FROM borrow_request
       WHERE status = 'PENDING'
       GROUP BY copy_id
      HAVING count(*) > 1
    ) AS duplicated;

  IF coalesce(v_count, 0) = 0 THEN RETURN; END IF;

  RAISE EXCEPTION
    'Cannot enable borrow requests: % cop(y/ies) already have more than one pending request (%). A librarian must answer them; a deployment must not pick one child and discard the rest.',
    v_count, v_copies USING ERRCODE = 'raise_exception';
END $$;

-- ---------------------------------------------------------------------------
-- 1. Borrow requests (generated).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "BorrowRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "borrow_request" (
    "id" TEXT NOT NULL,
    "copy_id" TEXT NOT NULL,
    "member_user_id" TEXT NOT NULL,
    "status" "BorrowRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "loan_id" TEXT,

    CONSTRAINT "borrow_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "borrow_request_copy_id_status_idx" ON "borrow_request"("copy_id", "status");

-- CreateIndex
CREATE INDEX "borrow_request_member_user_id_status_idx" ON "borrow_request"("member_user_id", "status");

-- AddForeignKey
ALTER TABLE "borrow_request" ADD CONSTRAINT "borrow_request_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "book_copy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrow_request" ADD CONSTRAINT "borrow_request_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrow_request" ADD CONSTRAINT "borrow_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrow_request" ADD CONSTRAINT "borrow_request_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. One child at a time may be waiting for one physical book.
--
--    Not expressible in schema.prisma, so it never appears in a generated
--    diff. It is what makes a double-tapped button, or two children asking in
--    the same second, impossible rather than merely unlikely. Also recorded in
--    prisma/sql/007_v1_role_model_and_borrow_requests.sql.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "borrow_request_one_pending_per_copy"
    ON "borrow_request" ("copy_id")
 WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------------------
-- 3. The permission a child holds to ask for a book.
--
--    Granted to readers and to Super Admin, exactly like `loan.request_renewal`
--    before it. NOT granted to Librarian: staff issue books at the desk with
--    `loan.issue`, and a librarian raising a request in a child's name would
--    put words in their mouth.
-- ---------------------------------------------------------------------------
INSERT INTO "permission" ("key", "category", "description")
VALUES (
  'loan.request',
  'circulation',
  'Ask a librarian to borrow a book you have found in the catalogue'
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_key")
SELECT r."id", 'loan.request'
  FROM "role" r
 WHERE r."key" IN ('MEMBER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Deciding a child's registration, and closing a membership, become Super
--    Admin only.
--
--    Deleting a role_permission row takes a capability away from a screen. It
--    takes nothing away from the library's records: every registration already
--    reviewed, and every account already closed, is exactly as it was.
-- ---------------------------------------------------------------------------
DELETE FROM "role_permission" rp
 USING "role" r
 WHERE rp."role_id" = r."id"
   AND r."key" <> 'SUPER_ADMIN'
   AND rp."permission_key" IN ('registration.review', 'member.deactivate');

-- ---------------------------------------------------------------------------
-- 5. GUARDIAN becomes dormant, alongside JUNIOR_LIBRARIAN.
--
--    `getActor` skips a non-assignable role when it works out what somebody may
--    do, so this closes the role rather than merely hiding it. No user_role row
--    anywhere points at GUARDIAN — nothing in the application has ever granted
--    it — so this changes what nobody can do.
-- ---------------------------------------------------------------------------
UPDATE "role" SET "is_assignable" = false WHERE "key" IN ('GUARDIAN', 'JUNIOR_LIBRARIAN');
