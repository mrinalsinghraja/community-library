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
