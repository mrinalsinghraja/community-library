-- CreateEnum
CREATE TYPE "GuardianVerificationMethod" AS ENUM ('SELF_DECLARED', 'EMAIL_CONFIRMATION', 'STAFF_VERIFIED', 'VERIFIED_IDENTITY_PROVIDER', 'OTHER');

-- CreateEnum
CREATE TYPE "GuardianVerificationStrength" AS ENUM ('NONE', 'SELF_DECLARED', 'EMAIL_CONFIRMED', 'STAFF_VERIFIED', 'IDENTITY_PROVIDER');

-- CreateEnum
CREATE TYPE "GuardianVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "library_settings" ADD COLUMN     "guardian_verification_version" TEXT NOT NULL DEFAULT '2026-08-v1',
ADD COLUMN     "required_guardian_verification" "GuardianVerificationStrength" NOT NULL DEFAULT 'SELF_DECLARED';

-- AlterTable
ALTER TABLE "media_object" ADD COLUMN     "delete_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pending_deletion_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "guardian_verification" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "method" "GuardianVerificationMethod" NOT NULL,
    "status" "GuardianVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "strength" "GuardianVerificationStrength" NOT NULL,
    "verification_version" TEXT NOT NULL,
    "guardian_id" TEXT,
    "member_user_id" TEXT,
    "registration_request_id" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "performed_by_id" TEXT,
    "evidence_note" TEXT,
    "challenge_token_hash" TEXT,
    "challenge_expires_at" TIMESTAMPTZ(6),
    "challenge_attempts" INTEGER NOT NULL DEFAULT 0,
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardian_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guardian_verification_challenge_token_hash_key" ON "guardian_verification"("challenge_token_hash");

-- CreateIndex
CREATE INDEX "guardian_verification_library_id_status_strength_idx" ON "guardian_verification"("library_id", "status", "strength");

-- CreateIndex
CREATE INDEX "guardian_verification_registration_request_id_idx" ON "guardian_verification"("registration_request_id");

-- CreateIndex
CREATE INDEX "guardian_verification_member_user_id_idx" ON "guardian_verification"("member_user_id");

-- CreateIndex
CREATE INDEX "guardian_verification_guardian_id_idx" ON "guardian_verification"("guardian_id");

-- CreateIndex
CREATE INDEX "media_object_pending_deletion_at_idx" ON "media_object"("pending_deletion_at");

-- AddForeignKey
ALTER TABLE "guardian_verification" ADD CONSTRAINT "guardian_verification_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_verification" ADD CONSTRAINT "guardian_verification_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_verification" ADD CONSTRAINT "guardian_verification_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_verification" ADD CONSTRAINT "guardian_verification_registration_request_id_fkey" FOREIGN KEY ("registration_request_id") REFERENCES "registration_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_verification" ADD CONSTRAINT "guardian_verification_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions. Kept in sync with prisma/sql/003_verification_and_media_lifecycle.sql
-- ===========================================================================
-- ===========================================================================
-- Phase 1.1 — guarantees Prisma's schema language cannot express.
--
-- Theme: a tickbox must never be able to describe itself as a verified
-- identity, and a private child photograph must never outlive the row that
-- points at it. Both are enforced here, in the database, so that an
-- application-layer bug cannot produce either state.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A verification is always about somebody.
--    Same rule the consent ledger already carries: evidence attached to nothing
--    is not evidence.
-- ---------------------------------------------------------------------------
ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_has_subject
  CHECK (
    guardian_id IS NOT NULL
    OR member_user_id IS NOT NULL
    OR registration_request_id IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 2. THE IMPORTANT ONE.
--
--    The strength of a verification is a function of its method, and the
--    database will not store any other pairing. Without this, one wrong literal
--    in a service could record "somebody ticked a box" as IDENTITY_PROVIDER and
--    sail straight through the production activation gate.
--
--    OTHER is deliberately unconstrained: it exists for a method a future legal
--    review introduces, whose worth that review will decide.
-- ---------------------------------------------------------------------------
ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_strength_matches_method
  CHECK (
    (method = 'SELF_DECLARED'              AND strength = 'SELF_DECLARED')
    OR (method = 'EMAIL_CONFIRMATION'      AND strength = 'EMAIL_CONFIRMED')
    OR (method = 'STAFF_VERIFIED'          AND strength = 'STAFF_VERIFIED')
    OR (method = 'VERIFIED_IDENTITY_PROVIDER' AND strength = 'IDENTITY_PROVIDER')
    OR method = 'OTHER'
  );

-- ---------------------------------------------------------------------------
-- 3. A verification that claims to have happened records when.
-- ---------------------------------------------------------------------------
ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_verified_has_timestamp
  CHECK (status <> 'VERIFIED' OR verified_at IS NOT NULL);

ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_revoked_has_timestamp
  CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 4. "A member of staff confirmed it" is worth nothing without which member of
--    staff. Recorded once it has actually been performed.
-- ---------------------------------------------------------------------------
ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_staff_method_names_the_staff
  CHECK (
    method <> 'STAFF_VERIFIED'
    OR status <> 'VERIFIED'
    OR performed_by_id IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 5. A challenge that exists has a deadline. An eternal single-use link is a
--    permanent takeover route into a child's account.
-- ---------------------------------------------------------------------------
ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_challenge_expires
  CHECK (challenge_token_hash IS NULL OR challenge_expires_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 6. evidence_note is a sentence a librarian writes, not a document store.
--    The cap is a deliberate obstacle to the habit of pasting identity details
--    into a free-text field — this system stores no identity documents and no
--    government identifiers of any kind.
-- ---------------------------------------------------------------------------
ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_evidence_note_is_short
  CHECK (evidence_note IS NULL OR char_length(evidence_note) <= 500);

-- ---------------------------------------------------------------------------
-- 7. Media lifecycle sanity.
-- ---------------------------------------------------------------------------
ALTER TABLE media_object
  ADD CONSTRAINT media_object_delete_attempts_non_negative
  CHECK (delete_attempts >= 0);

-- ---------------------------------------------------------------------------
-- 8. The sweeper's working index: due objects only, so the scan stays tiny
--    however much media the library accumulates.
--    Partial and expression-based, which is also what stops `prisma migrate dev`
--    quietly dropping it on the next migration (see docs/DATABASE.md).
-- ---------------------------------------------------------------------------
CREATE INDEX media_object_sweep_due
  ON media_object (pending_deletion_at)
  WHERE pending_deletion_at IS NOT NULL;
