-- ADR-077: anonymous daily usage counts for the /report page.
CREATE TABLE "usage_daily" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "feature" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usage_daily_key" ON "usage_daily"("library_id", "day", "feature", "country", "region", "city");
CREATE INDEX "usage_daily_library_id_day_idx" ON "usage_daily"("library_id", "day");

CREATE TABLE "usage_visitor" (
    "library_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "visitor_hash" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    CONSTRAINT "usage_visitor_pkey" PRIMARY KEY ("library_id", "day", "visitor_hash", "feature")
);

CREATE INDEX "usage_visitor_library_id_day_idx" ON "usage_visitor"("library_id", "day");
