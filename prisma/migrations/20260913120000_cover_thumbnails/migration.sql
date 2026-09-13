-- A small WebP copy of each book cover, so a catalogue card or a desk row stops
-- downloading the full jacket (ADR-072).
--
-- Purely additive: four nullable columns, one unique index and three CHECKs.
-- No existing row changes, no default is backfilled here, and every row that
-- exists today stays valid -- all four columns start null, which is what
-- "no thumbnail yet" means. The backfill is a separate, opt-in script.

ALTER TABLE "media_object"
  ADD COLUMN "thumb_storage_key" TEXT,
  ADD COLUMN "thumb_mime_type" TEXT,
  ADD COLUMN "thumb_byte_size" INTEGER,
  ADD COLUMN "thumb_checksum_sha256" TEXT;

CREATE UNIQUE INDEX "media_object_thumb_storage_key_key" ON "media_object"("thumb_storage_key");

-- All four describe one object, so they arrive and leave together.
ALTER TABLE "media_object"
  ADD CONSTRAINT "media_object_thumb_all_or_nothing"
  CHECK (
    ("thumb_storage_key" IS NULL) = ("thumb_mime_type" IS NULL)
    AND ("thumb_storage_key" IS NULL) = ("thumb_byte_size" IS NULL)
    AND ("thumb_storage_key" IS NULL) = ("thumb_checksum_sha256" IS NULL)
  );

-- The one that matters. A derived copy of a child's photograph would be new
-- personal data with its own erasure and retention story, so the database
-- refuses to hold one whatever the application, a script or a person does.
ALTER TABLE "media_object"
  ADD CONSTRAINT "media_object_thumb_only_for_covers"
  CHECK ("thumb_storage_key" IS NULL OR "purpose" = 'book_cover');

ALTER TABLE "media_object"
  ADD CONSTRAINT "media_object_thumb_byte_size_positive"
  CHECK ("thumb_byte_size" IS NULL OR "thumb_byte_size" > 0);
