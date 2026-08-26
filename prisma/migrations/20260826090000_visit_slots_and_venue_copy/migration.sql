-- Visiting times, and the copy that says where the library room is.
--
-- Additive only: three nullable-or-defaulted columns on library_settings, one
-- new enum and one new table. Nothing existing is rewritten, so this is safe to
-- apply to a live database while the old build is still serving.

-- CreateEnum
CREATE TYPE "VisitSlotStatus" AS ENUM ('OPEN', 'CANCELLED');

-- AlterTable
ALTER TABLE "library_settings"
  ADD COLUMN "venue_name" TEXT NOT NULL DEFAULT 'library room',
  ADD COLUMN "venue_address" TEXT,
  ADD COLUMN "eligibility_note" TEXT;

-- CreateTable
CREATE TABLE "visit_slot" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "slot_date" DATE NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "status" "VisitSlotStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "cancelled_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "visit_slot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_slot_library_id_slot_date_start_minute_key"
  ON "visit_slot"("library_id", "slot_date", "start_minute");

-- CreateIndex
CREATE INDEX "visit_slot_library_id_slot_date_idx" ON "visit_slot"("library_id", "slot_date");

-- AddForeignKey
ALTER TABLE "visit_slot" ADD CONSTRAINT "visit_slot_library_id_fkey"
  FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
