-- ===========================================================================
-- Hand-written guarantees that Prisma's schema language cannot express.
-- These are the database's own defences: they hold even if application code
-- is wrong, raced, or bypassed entirely.
-- ===========================================================================

-- Fuzzy title search for readers who are still learning to spell.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. A physical copy can be on loan to exactly one reader at a time.
--    This is the final line of defence against a double issue; disabling a
--    button in the browser is not a guarantee of anything.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX one_active_loan_per_copy
  ON loan (copy_id)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 2. The same child in the same flat cannot sit in the queue twice.
--    Case- and whitespace-insensitive so "Aarav " and "aarav" collide.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX one_open_registration_per_child
  ON registration_request (library_id, lower(btrim(child_name)), lower(btrim(apartment)))
  WHERE status IN ('PENDING', 'UNDER_REVIEW');

-- ---------------------------------------------------------------------------
-- 3. Login identifiers are stored normalised, so uniqueness cannot be defeated
--    by changing case. The service layer lowercases; the database insists.
-- ---------------------------------------------------------------------------
ALTER TABLE app_user
  ADD CONSTRAINT app_user_email_is_normalised
    CHECK (email IS NULL OR email = lower(btrim(email))),
  ADD CONSTRAINT app_user_username_is_normalised
    CHECK (username IS NULL OR username = lower(btrim(username))),
  ADD CONSTRAINT app_user_username_shape
    CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9-]{2,19}$'),
  ADD CONSTRAINT app_user_failed_login_count_non_negative
    CHECK (failed_login_count >= 0);

ALTER TABLE guardian
  ADD CONSTRAINT guardian_email_is_normalised
    CHECK (email = lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- 4. Loans must be coherent in time.
-- ---------------------------------------------------------------------------
ALTER TABLE loan
  ADD CONSTRAINT loan_due_after_issue
    CHECK (due_at > issued_at),
  ADD CONSTRAINT loan_returned_after_issue
    CHECK (returned_at IS NULL OR returned_at >= issued_at),
  ADD CONSTRAINT loan_renewal_count_non_negative
    CHECK (renewal_count >= 0),
  -- A RETURNED loan must record when; an ACTIVE loan must not.
  ADD CONSTRAINT loan_return_fields_match_status
    CHECK (
      (status = 'RETURNED' AND returned_at IS NOT NULL)
      OR (status = 'ACTIVE' AND returned_at IS NULL)
      OR status IN ('LOST', 'WRITTEN_OFF')
    );

-- ---------------------------------------------------------------------------
-- 5. Configuration cannot be saved in a state that breaks the library.
--    Every one of these is a rule an admin could otherwise typo into chaos.
-- ---------------------------------------------------------------------------
ALTER TABLE library_settings
  ADD CONSTRAINT library_settings_sane_age_range
    CHECK (age_min >= 0 AND age_max > age_min AND age_max <= 25),
  ADD CONSTRAINT library_settings_positive_borrowing_period
    CHECK (borrowing_period_days BETWEEN 1 AND 365),
  ADD CONSTRAINT library_settings_positive_renewal_period
    CHECK (renewal_period_days BETWEEN 1 AND 365),
  ADD CONSTRAINT library_settings_sane_limits
    CHECK (max_active_loans BETWEEN 1 AND 50 AND max_renewals BETWEEN 0 AND 20),
  ADD CONSTRAINT library_settings_non_negative_overdue_block
    CHECK (block_on_overdue_days >= 0),
  ADD CONSTRAINT library_settings_code_padding
    CHECK (copy_code_padding BETWEEN 1 AND 10 AND member_code_padding BETWEEN 1 AND 10),
  ADD CONSTRAINT library_settings_prefixes_present
    CHECK (btrim(copy_code_prefix) <> '' AND btrim(member_code_prefix) <> ''),
  -- Branding colours must be real hex so a bad value cannot break every page.
  ADD CONSTRAINT library_settings_colour_format
    CHECK (primary_color ~* '^#[0-9a-f]{6}$' AND secondary_color ~* '^#[0-9a-f]{6}$');

-- ---------------------------------------------------------------------------
-- 6. Consent is evidence. A withdrawal must say when it happened, and a grant
--    must always carry the wording that was actually shown.
-- ---------------------------------------------------------------------------
ALTER TABLE consent_record
  ADD CONSTRAINT consent_withdrawal_has_timestamp
    CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  ADD CONSTRAINT consent_text_snapshot_present
    CHECK (btrim(consent_text_snapshot) <> '' AND btrim(consent_version) <> ''),
  -- Consent must attach to something it is consent *for*.
  ADD CONSTRAINT consent_has_subject
    CHECK (member_user_id IS NOT NULL OR registration_request_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 7. A named donor credit must actually have a name to show.
-- ---------------------------------------------------------------------------
ALTER TABLE donation
  ADD CONSTRAINT donation_named_credit_has_name
    CHECK (display_consent <> 'NAMED' OR btrim(donor_name) <> ''),
  ADD CONSTRAINT donation_apartment_credit_has_apartment
    CHECK (display_consent <> 'APARTMENT_ONLY' OR btrim(coalesce(donor_apartment, '')) <> '');

-- ---------------------------------------------------------------------------
-- 8. Members have a plausible year of birth and a real card code.
--
--    A year, not a date. ADR-051 dropped date_of_birth and child_dob outright:
--    the library needs to know roughly how old a child is, and a full birthday
--    is one of the few facts that identifies a person for life. The range here
--    is a sanity bound only -- the real one comes from the library's own
--    ageMin/ageMax and lives in the service, which is the only thing that
--    knows it.
-- ---------------------------------------------------------------------------
ALTER TABLE member_profile
  ADD CONSTRAINT member_profile_birth_year_plausible
    CHECK (birth_year BETWEEN 1900 AND 2200),
  ADD CONSTRAINT member_code_present
    CHECK (btrim(member_code) <> '');

ALTER TABLE registration_request
  ADD CONSTRAINT registration_request_birth_year_plausible
    CHECK (child_birth_year BETWEEN 1900 AND 2200);

-- ---------------------------------------------------------------------------
-- 9. Sessions cannot be created already dead, and idle expiry can never
--    outlive absolute expiry.
-- ---------------------------------------------------------------------------
ALTER TABLE "session"
  ADD CONSTRAINT session_idle_within_absolute
    CHECK (idle_expires_at <= expires_at),
  ADD CONSTRAINT session_expires_after_creation
    CHECK (expires_at > created_at);

ALTER TABLE auth_token
  ADD CONSTRAINT auth_token_expires_after_creation
    CHECK (expires_at > created_at);

-- ---------------------------------------------------------------------------
-- 10. Uploaded objects: private things must not carry a public URL.
-- ---------------------------------------------------------------------------
ALTER TABLE media_object
  ADD CONSTRAINT media_private_has_no_public_url
    CHECK (visibility <> 'PRIVATE' OR public_url IS NULL),
  ADD CONSTRAINT media_public_has_public_url
    CHECK (visibility <> 'PUBLIC' OR public_url IS NOT NULL),
  ADD CONSTRAINT media_byte_size_positive
    CHECK (byte_size > 0);

-- ---------------------------------------------------------------------------
-- 11. Search indexes. Full text for real queries, trigram for misspellings.
-- ---------------------------------------------------------------------------
-- array_to_string() is only STABLE, so it cannot appear directly in an index
-- expression. Wrapping it in a function we declare IMMUTABLE is the standard
-- workaround: with a constant separator over text[], the result really is
-- deterministic. Keep this function and the index definition in step.
CREATE OR REPLACE FUNCTION book_title_search_vector(p_title text, p_authors text[])
  RETURNS tsvector
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    coalesce(p_title, '') || ' ' || coalesce(array_to_string(p_authors, ' '), '')
  );
$$;

CREATE INDEX book_title_fulltext_idx
  ON book_title
  USING gin (book_title_search_vector(title, authors));

-- NOTE: this is deliberately an *expression* index on lower(title), not a plain
-- column index. `prisma migrate dev` drops raw indexes it can introspect but
-- does not find in schema.prisma; expression indexes are invisible to it and
-- therefore survive. Query it as: WHERE lower(title) % lower($1).
CREATE INDEX book_title_trgm_idx
  ON book_title
  USING gin (lower(title) gin_trgm_ops);

-- Case-insensitive lookup of a member by card code, used on every issue.
CREATE INDEX member_profile_code_lower_idx
  ON member_profile (library_id, lower(member_code));

CREATE INDEX book_copy_code_lower_idx
  ON book_copy (library_id, lower(copy_code));
