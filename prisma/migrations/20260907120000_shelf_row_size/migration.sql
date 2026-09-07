-- How many books sit on one physical row of shelving.
--
-- Nullable with no default: null means "nobody has measured it", which is where
-- every existing library stands the moment this column appears. A library that
-- does not set it shows book codes with no row beside them, exactly as before.
ALTER TABLE "library_settings" ADD COLUMN "shelf_row_size" INTEGER;

-- A row cannot hold nought books, and a five-figure row is a typo rather than a
-- shelf. The upper bound is deliberately loose: it exists to catch a slipped
-- keystroke, not to have an opinion about somebody's furniture.
ALTER TABLE "library_settings"
  ADD CONSTRAINT "library_settings_shelf_row_size_positive"
  CHECK ("shelf_row_size" IS NULL OR ("shelf_row_size" >= 1 AND "shelf_row_size" <= 1000));
