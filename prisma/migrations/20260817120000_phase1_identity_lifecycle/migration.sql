-- Phase 1 — identity, registration and account lifecycle.
--
-- Hand-written rather than generated, because the ConsentMethod change is a
-- RENAME of existing values. Prisma's generated migration would drop and
-- recreate the enum, destroying consent records — and a consent record is
-- evidence of what a guardian agreed to, so it must survive a rename.

-- ---------------------------------------------------------------------------
-- 1. ConsentMethod: rename to the verification-strength vocabulary, and add the
--    two methods a future legal review may require. Renaming preserves every
--    existing row and its meaning.
-- ---------------------------------------------------------------------------
ALTER TYPE "ConsentMethod" RENAME VALUE 'GUARDIAN_ONLINE_FORM' TO 'WEB_FORM';
ALTER TYPE "ConsentMethod" RENAME VALUE 'LIBRARIAN_RECORDED_IN_PERSON' TO 'ADMIN_VERIFIED';

-- Positioned so the database's enum ordering matches schema.prisma exactly,
-- which keeps `prisma migrate diff` reporting no drift.
ALTER TYPE "ConsentMethod" ADD VALUE 'EMAIL_CONFIRMATION' BEFORE 'ADMIN_VERIFIED';
ALTER TYPE "ConsentMethod" ADD VALUE 'OTHER_VERIFIED_METHOD' AFTER 'ADMIN_VERIFIED';

ALTER TABLE "consent_record" ALTER COLUMN "method" SET DEFAULT 'WEB_FORM';

-- ---------------------------------------------------------------------------
-- 2. app_user: password age, and the internal record of a status change.
-- ---------------------------------------------------------------------------
ALTER TABLE "app_user"
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(6),
  ADD COLUMN "status_reason" TEXT,
  ADD COLUMN "status_changed_at" TIMESTAMPTZ(6),
  ADD COLUMN "status_changed_by_id" TEXT;

-- Existing accounts that already have a password: treat it as set at creation,
-- so session-age comparisons have a sane baseline rather than NULL.
UPDATE "app_user"
   SET "password_changed_at" = "created_at"
 WHERE "password_hash" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. auth_token: explicit revocation, plus abuse signals.
--
--    Revoked, consumed and expired are three different things and the audit
--    trail must be able to tell them apart: "the link was cancelled" is a very
--    different event from "the link was used twice".
-- ---------------------------------------------------------------------------
ALTER TABLE "auth_token"
  ADD COLUMN "revoked_at" TIMESTAMPTZ(6),
  ADD COLUMN "requested_ip_hash" TEXT,
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "auth_token"
  ADD CONSTRAINT "auth_token_attempt_count_non_negative"
    CHECK ("attempt_count" >= 0);

-- Finding a live token for a user is the hot path on every activation and
-- reset; this index serves it.
CREATE INDEX "auth_token_live_idx"
  ON "auth_token" ("user_id", "type", "expires_at")
  WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;
