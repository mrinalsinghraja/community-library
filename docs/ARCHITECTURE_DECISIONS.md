# Architecture Decision Records

Each record states the decision, why, what else was considered, and what it
costs. Decisions are appended, never rewritten — if one is reversed, a new
record supersedes it.

---

## ADR-001 — Modular monolith on Next.js

**Decision.** One Next.js application (App Router, TypeScript strict) with
internal layer boundaries enforced by lint, rather than separate services.

**Why.** The load is a few hundred people and a few thousand books. Every
operational cost lands on a volunteer. A single deployable is the smallest
thing that can be correct.

**Alternatives.** Separate API service (needless network boundary); serverless
functions per operation (harder to keep transactional).

**Cost.** Scaling is vertical only. Irrelevant at this size.

---

## ADR-002 — Neon PostgreSQL rather than Supabase

**Decision.** Neon for the database; Vercel Blob for files.

**Why.** Supabase free projects pause after inactivity and need a manual
restore from the dashboard. A community library that sees no traffic for a week
is exactly that profile, and a librarian meeting a dead database on a Saturday
morning is a real failure. Neon auto-suspends and auto-resumes. No
Supabase-specific feature was in use: the browser never touches the database, so
no row-level security, no Supabase Auth, no Realtime.

**Verified 2026-08-17** against Neon's published plan documentation: free tier
gives 100 projects, 10 branches per project, 0.5 GB storage per project, 100
CU-hours per project per month, scale-to-zero after 5 minutes (not disableable),
and **point-in-time restore limited to 6 hours**.

**Consequence.** That 6-hour restore window is thin. A scheduled logical backup
is therefore required, not optional — see `docs/OPERATIONS.md`.

**Approved by the owner** on 2026-08-16 as a change from the original brief.

---

## ADR-003 — Prisma 6, not 7

**Decision.** Pin Prisma to 6.19.x.

**Why.** Prisma 7 changes client generation and module layout. Phase 0's job is
a stable foundation; a major ORM migration is not part of it. The blueprint
specified Prisma 6.

**Cost.** A future major upgrade. Scheduled deliberately, not stumbled into.

---

## ADR-004 — Next.js 16, not 15

**Decision.** Next 16.3.x, a deviation from the blueprint's "Next.js 15".

**Why.** 16 is the current stable line and the one receiving security patches.
Vercel refuses deploys of Next versions with known CVEs, so tracking the patched
line is an operational requirement, not a preference.

**Consequence.** `middleware.ts` is deprecated in 16 in favour of `proxy.ts`;
the file was renamed accordingly during Phase 0.

---

## ADR-005 — A child's login identity is a card code or a username

**Decision.** Members sign in with their library card code (`MJCL-R0042`) or a
username chosen at activation. One field accepts either. Staff use email.

**Why.** Children aged 5–14 mostly have no email address. Requiring one would
either exclude families or push several children onto a shared parent inbox.
The guardian's email is the recovery and notification channel, stored on
`guardian`, not an identity.

**Consequence.** Supabase Auth and any other email-centric identity provider
were ruled out. Login lookup checks `member_code`, then `username`, then
`email`, and fails with one generic message for all three.

**Approved by the owner** on 2026-08-16.

---

## ADR-006 — Member passwords: 6 characters, no complexity rules

> **The 6-character minimum is superseded by ADR-013 (8 characters).** The rest
> of this record — no complexity rules, the reasoning, the staff exception —
> still stands.

**Decision.** Members: minimum 6 characters, checked against a common-password
blocklist plus the library's own name from configuration, no character-class
requirements. Staff: minimum 12 characters, zxcvbn score ≥ 3.

**Why.** Complexity rules do not make a six-year-old's password stronger; they
make it written on a note stuck to the shelf. The data behind a member account
is a picture-book borrowing history. Compensating controls: 5 failures → a
15-minute lock, a per-IP hourly cap, and short sessions on shared devices.

**Explicitly not applied to staff**, who hold real power over children's data.

**Approved by the owner** on 2026-08-16 as a security decision.

---

## ADR-007 — Catalogue defaults to members only

**Decision.** `library_settings.catalogue_visibility` defaults to `MEMBER_ONLY`.
A Super Admin can switch it to `PUBLIC` without a deploy.

**Why.** The blueprint proposed public-by-default on the grounds that book data
contains no child data. The owner chose to keep the shelf behind the front
door for this deployment. Both remain available; only the default changed.

**Supersedes** the blueprint's §25 decision 3.

---

## ADR-008 — Librarian-only issue and return

**Decision.** Children cannot issue, return or renew. They may raise a renewal
*request*, which a librarian approves.

**Why.** A physical book changes hands at the desk, so the desk records it.
This is also the simplest thing to make hard to misuse.

**Consequence.** `renewal_request` exists in the schema from migration 1. Self
checkout is out of scope and recorded in the roadmap.

**Approved by the owner** on 2026-08-16.

---

## ADR-009 — Opaque server-side sessions, because Credentials cannot use native database sessions

**Decision.** Auth.js issues a cookie containing a single opaque claim, `sid`.
Session state lives in our own `session` table; only the SHA-256 of the handle
is stored. Every request resolves the handle, re-reads the user's status, and
re-computes permissions from the database.

**Why this is not simply "database sessions".** The requirement was database
sessions specifically so that suspension takes effect promptly. While
implementing it, the constraint was verified directly in the installed source —
`node_modules/@auth/core/lib/actions/callback/index.js`, the
`provider.type === "credentials"` branch — which always encodes and sets a token
cookie and **never** calls `adapter.createSession`, whatever `session.strategy`
is set to. Native database sessions are therefore unreachable from any password
login in Auth.js v5.

**What was done instead.** The cookie is reduced to a bearer reference. It
carries no roles, no identity, no permissions — nothing that could be stale.
Everything that governs access is read from the database on every request. The
cookie is transport; the table is truth.

**Verified.** Suspend an active member, and the next request with their existing
cookie redirects to sign-in with zero session rows remaining. Covered by
database tests and confirmed end to end against the running application.

**Alternatives.** A self-contained JWT with roles (rejected: unrevokable until
expiry, which is exactly the failure mode to avoid); dropping Auth.js and
hand-rolling sign-in (rejected: it would mean writing our own CSRF and cookie
encryption, and "do not invent cryptography" applies).

**Cost.** One indexed session query per request. Irrelevant at this scale, and
it buys instant revocation.

---

## ADR-010 — Codes allocated by a single atomic UPDATE

**Decision.** `code_sequence` holds one row per (library, kind). Allocation is
`UPDATE ... SET next_value = next_value + 1 ... RETURNING next_value - 1`.

**Why.** Two librarians cataloguing at the same desk must never receive the same
number. A `SELECT max(...)` followed by an insert has a race window between the
statements; a single UPDATE takes a row lock for its duration, so concurrent
callers serialise. The unique index on `(library_id, copy_code)` sits behind it.

**Verified.** 40 parallel allocations yield 40 distinct consecutive values, and a
failed surrounding transaction rolls the reservation back rather than burning a
code.

---

## ADR-011 — Consent is a ledger, not a boolean

**Decision.** `consent_record` stores type, status, method, version, a verbatim
snapshot of the wording shown, who recorded it, when, and when it was withdrawn.

**Why.** India's DPDP Act 2023 requires verifiable parental consent for
processing a child's personal data. `consent = true` records nothing about
*what* was agreed to. Storing the wording verbatim means a later change to the
text cannot rewrite what a family actually agreed to.

**Not a compliance claim.** The wording and the strength of verification have
not been reviewed by a lawyer. See `docs/SECURITY.md`. The model is deliberately
shaped so stronger verification can be added as a new `ConsentMethod` without
touching the registration workflow.

---

## ADR-012 — Hand-written SQL for constraints Prisma cannot express

**Decision.** Partial unique indexes, CHECK constraints and expression indexes
live in `prisma/sql/001_constraints_and_indexes.sql`, appended to the migration.

**Why.** The guarantees that matter most — one active loan per copy, one open
registration per child, coherent loan dates, valid configuration — cannot be
written in Prisma's schema language, and enforcing them only in application code
means they hold until the first race or the first bug.

**Gotcha found during Phase 0.** `prisma migrate dev` silently **drops** raw
indexes it can introspect but cannot find in `schema.prisma`. A plain
`gin (title gin_trgm_ops)` index was removed on the next migrate. Expression
indexes are invisible to that reconciliation, so the index is now defined on
`lower(title)` — which is what case-insensitive fuzzy search wanted anyway.
CI checks for drift on every run.

---

## ADR-013 — Member password minimum raised from 6 to 8 characters

**Decision.** `PASSWORD_POLICY.member.minLength` = 8. Still no complexity rules.

**Why.** The Phase 1 brief asked for this to be re-examined rather than
preserved by default, and re-examination found 6 too few. Lowercase-only at 6
characters is roughly 3×10⁸ candidates. Argon2id at 19 MiB makes that expensive
rather than impossible, and a child's password is often reused elsewhere, so the
blast radius of a database compromise is not limited to borrowing history.

8 characters raises the space about a thousandfold, and costs a child nothing —
because what we ask for is *length*, not symbols. "bluecatjumps", "dragonfly",
"my dog rex" all pass. The form teaches the habit that actually helps: join two
words together.

**Also added:** the person's own name, username and card code are refused, split
into words so "Rosalind Chen" blocks `rosalind99`.

**Rejected.** 12 characters for members (unusable for a five-year-old);
character-class rules (they produce sticky notes, not entropy).

**Supersedes** the minimum set in ADR-006. Everything else in ADR-006 stands.

---

## ADR-014 — ConsentMethod renamed to a verification-strength vocabulary

**Decision.** `GUARDIAN_ONLINE_FORM` → `WEB_FORM`,
`LIBRARIAN_RECORDED_IN_PERSON` → `ADMIN_VERIFIED`, plus `EMAIL_CONFIRMATION` and
`OTHER_VERIFIED_METHOD`.

**Why.** The original names described *where* consent came from. What matters
legally is *how strongly it was verified*. India's DPDP Act requires verifiable
parental consent, and if a review demands something stronger than a tickbox, the
system must be able to express it without a rewrite.

**How.** `ALTER TYPE … RENAME VALUE`, hand-written. Prisma's generated migration
would have dropped and recreated the enum, destroying every consent record — and
a consent record is evidence of what a family agreed to. `ADD VALUE … BEFORE/AFTER`
positions the new members so the database's enum ordering matches
`schema.prisma`, keeping `migrate diff` clean.

**Consequence.** Adding a stronger verification method is now a new enum value
plus a code path — not a schema change and not a data migration.

---

## ADR-015 — Changing a password ends every session, including the current one

**Decision.** `changeOwnPassword` deletes all sessions for the user. The action
redirects to sign-in.

**Why.** Phase 1 added a rule to `resolveSession`: a session created before
`password_changed_at` is not trusted. That rule makes "changing the password
signs out every other device" true by construction rather than by remembering to
call a function — but it also makes keeping the *current* session impossible,
because that session is also older than the new password.

Keeping it alive would mean rotating its cookie, which only the auth layer can
do; the service layer cannot set cookies. The options were to weaken the rule,
plumb cookie rotation through Auth.js, or sign out.

Signing out is the strictest reading and the simplest to explain: if the change
was made by someone who should not have had the device, they lose it too.

**Cost.** One extra sign-in after a password change. The UI says so plainly.

---

## ADR-016 — Page guards are cosmetic; services remain the boundary

**Decision.** `src/server/page-guards.ts` redirects a person who reaches a page
they may not see. Services continue to throw.

**Why.** Before this, a child tapping a stale link to `/desk` got a 500. Access
was correctly denied — the service threw `NotAuthorizedError` — but a crash page
is the wrong answer for a nine-year-old, and it violates the project's own rule
that errors must be understandable.

**What it is not.** It is not the security boundary, and the module says so at
the top. The deny has already happened by the time a redirect is a possibility;
this only changes what the person sees. Every page behind a guard still calls a
service that checks permissions independently.

**Why it lives outside `@/server/authz`.** Services must never import routing.
Keeping `redirect()` out of the authorization module preserves that.
