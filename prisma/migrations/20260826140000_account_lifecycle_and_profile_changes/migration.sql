-- Growing up, leaving, and asking for a correction.
--
-- Additive only. Two new values on an existing enum, one new enum, one new
-- table. No existing row is rewritten and no column changes type, so the build
-- currently serving is unaffected by all of it.
--
-- NOTE on the enum: PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE inside a
-- transaction as long as the new value is not USED in the same transaction.
-- Nothing below writes a GROWN_UP or LEFT row, so this is safe as one migration.

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'GROWN_UP';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'LEFT';

-- CreateEnum
CREATE TYPE "ProfileChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "profile_change_request" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "member_user_id" TEXT NOT NULL,
    "status" "ProfileChangeStatus" NOT NULL DEFAULT 'PENDING',
    "proposed" JSONB NOT NULL,
    "note" TEXT,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profile_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_change_request_library_id_status_created_at_idx"
  ON "profile_change_request"("library_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "profile_change_request_member_user_id_status_idx"
  ON "profile_change_request"("member_user_id", "status");

-- AddForeignKey
ALTER TABLE "profile_change_request" ADD CONSTRAINT "profile_change_request_library_id_fkey"
  FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_change_request" ADD CONSTRAINT "profile_change_request_member_user_id_fkey"
  FOREIGN KEY ("member_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_change_request" ADD CONSTRAINT "profile_change_request_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
