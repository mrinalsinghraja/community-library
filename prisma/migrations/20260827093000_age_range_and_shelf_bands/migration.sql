-- Two changes, both about who this library is for.
--
-- 1. The membership range now runs to 16. `age_max` is per-library configuration
--    and an administrator can change it at /admin/settings, so this only moves a
--    library still sitting on the old default -- it does not overwrite a range
--    somebody has deliberately chosen.
--
-- 2. The shelf bands are regrouped into three that cover the whole membership
--    range with no gap. The old three left 15- and 16-year-olds with no band at
--    all, and stopped at 14 because that is where membership used to stop.
--
--      5-7   unchanged
--      8-10  becomes  8-11
--      11-14 becomes  12-16
--
--    RENAME VALUE rather than a new enum: every row keeps its band without a
--    rewrite, and there is no window where a book has no band. A title banded
--    for 11-year-olds is now banded 12-16, which is the one behaviour change
--    here; it was checked against production first, where all four titles are
--    ALL_AGES and none of them move.

ALTER TABLE "library_settings" ALTER COLUMN "age_max" SET DEFAULT 16;

UPDATE "library_settings" SET "age_max" = 16 WHERE "age_max" = 14;

ALTER TYPE "AgeGroup" RENAME VALUE 'AGE_8_10' TO 'AGE_8_11';
ALTER TYPE "AgeGroup" RENAME VALUE 'AGE_11_14' TO 'AGE_12_16';
