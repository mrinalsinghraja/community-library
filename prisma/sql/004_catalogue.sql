-- ===========================================================================
-- Phase 2 — the catalogue's guarantees, in the database.
--
-- Theme: a book record is a label on a physical object in a room full of
-- children. It must not be possible to create one with no title, no author, no
-- shelf, or a donor credit with nobody to credit — whatever an API caller
-- sends, and whatever a future refactor forgets.
--
-- The enums (age_group, condition, status) and the foreign key to
-- book_category already refuse invalid values by construction. What follows is
-- everything Prisma's schema language cannot say.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A book has a title and at least one author, and neither is whitespace.
--
--    The length caps mirror CATALOGUE_LIMITS in src/lib/catalogue.ts, which the
--    Zod schemas also read. Two layers, one number.
-- ---------------------------------------------------------------------------
ALTER TABLE book_title
  ADD CONSTRAINT book_title_has_title
    CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  ADD CONSTRAINT book_title_has_author
    CHECK (
      array_length(authors, 1) >= 1
      AND btrim(array_to_string(authors, '')) <> ''
    );

-- ---------------------------------------------------------------------------
-- 2. Archiving is a real event with a real timestamp, in both directions.
--
--    Without the reverse implication, a copy could carry an archive date while
--    sitting on the shelf as AVAILABLE — and "when did this leave the library?"
--    would have two different answers.
-- ---------------------------------------------------------------------------
ALTER TABLE book_copy
  ADD CONSTRAINT book_copy_archived_has_timestamp
    CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
  ADD CONSTRAINT book_copy_code_present
    CHECK (btrim(copy_code) <> '');

-- ---------------------------------------------------------------------------
-- 3. A donation credits somebody.
--
--    001_constraints_and_indexes.sql already requires a name for a NAMED credit
--    and an apartment for an APARTMENT_ONLY one. This adds the rule that holds
--    for every donation however it is displayed: a row exists because a real
--    family handed over a real book.
--
--    Note what is NOT here and never will be: donor phone, donor email, donor
--    address, and any count, total, rank or score. There is no column to hang a
--    leaderboard on, which is the most reliable way to not have one.
-- ---------------------------------------------------------------------------
ALTER TABLE donation
  ADD CONSTRAINT donation_donor_name_present
    CHECK (btrim(donor_name) <> '' AND char_length(donor_name) <= 120),
  ADD CONSTRAINT donation_apartment_is_short
    CHECK (donor_apartment IS NULL OR char_length(btrim(donor_apartment)) BETWEEN 1 AND 20),
  -- A librarian correcting a date can reach back as far as they like; nobody
  -- donates a book next March. One day of tolerance covers the library's
  -- timezone being ahead of the server's.
  ADD CONSTRAINT donation_not_in_the_future
    CHECK (donated_at <= CURRENT_DATE + 1);

-- ---------------------------------------------------------------------------
-- 4. Author search.
--
--    001 built a full-text index over title + authors, which answers whole-word
--    queries. This adds the trigram index that makes a *partial* author search
--    fast — a child typing "kipl" should find Kipling before they finish the
--    word, and `lower(...) LIKE '%kipl%'` can only use an index if that exact
--    expression is the one indexed.
--
--    array_to_string() is merely STABLE, so it cannot appear in an index
--    expression directly. Same workaround as book_title_search_vector: wrap it
--    in a function declared IMMUTABLE, which with a constant separator over
--    text[] it genuinely is. Keep this function and the index in step.
--
--    Expression-based on purpose. `prisma migrate dev` drops raw indexes it can
--    introspect but cannot find in schema.prisma; expression indexes are
--    invisible to it and therefore survive. See docs/DATABASE.md.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION book_title_authors_text(p_authors text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT lower(coalesce(array_to_string(p_authors, ' '), ''));
$$;

CREATE INDEX book_title_authors_trgm_idx
  ON book_title
  USING gin (book_title_authors_text(authors) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. The browse index.
--
--    Every child-facing query is "the copies in this library that are not
--    archived, newest first". Partial, so the index stays small and archived
--    books cost nothing to skip.
-- ---------------------------------------------------------------------------
CREATE INDEX book_copy_on_shelf_idx
  ON book_copy (library_id, created_at DESC)
  WHERE status <> 'ARCHIVED';
