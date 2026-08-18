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

## ADR-017 — Guardian verification is a separate model from consent

**Decision.** A new `guardian_verification` table, with its own methods, its own
ordered strengths, and its own lifecycle. `consent_record` keeps recording what a
family agreed to; it stops carrying any implication about who they are.

**Why.** These answer different questions. Consent asks *"did a guardian agree,
to what wording, when, and can they withdraw it?"*. Verification asks *"what
evidence is there that the person who agreed is really the guardian?"*. A ticked
box produces an excellent answer to the first and essentially none to the second.

Modelled together, raising the verification bar later would mean rewriting
consent history — a family who consented in August under wording v1 still
consented under wording v1, whatever the library later decides about identity
checks. Falsifying that to accommodate a policy change is not acceptable for a
record whose entire purpose is to be evidence.

**The visible consequence.** The registration queue shows two labelled states
rather than one green tick. That screen decides whether a child gets an account,
and it is the last place the two should be blurred.

**What the database enforces.** Strength is a function of method, checked by
`guardian_verification_strength_matches_method`. One wrong literal in a service
could otherwise store "somebody ticked a box" as `IDENTITY_PROVIDER` and pass the
production gate. The database refuses the row.

## ADR-018 — Required verification strength is configuration, never a constant

**Decision.** `library_settings.required_guardian_verification` decides what a
deployment demands. Default `SELF_DECLARED`, which is a development default and
is labelled as one.

**Why.** Whether a given method satisfies "verifiable parental consent" is a
legal question about a specific jurisdiction at a specific time. This software
must not answer it. Hard-coding any method as sufficient would be exactly the
claim the whole codebase is careful not to make.

It also means raising the bar is an operational change — one UPDATE — rather than
a deployment.

**Checked twice, not once.** At approval and again at activation. The requirement
can be raised while a request sits in the queue or while an activation email sits
unread in an inbox, and when the bar goes up the accounts it went up for must not
walk under it. Tested explicitly.

**Absence of evidence is the weakest state.** An account with no verification
record resolves to `NONE` and fails every requirement above `NONE`. The tempting
bug is to treat "no records found" as "nothing to check"; there is a test whose
only job is to keep that bug out.

**Fail-closed where unimplemented.** Setting the requirement to
`IDENTITY_PROVIDER` makes approval impossible, because nothing can currently
produce that strength. Deliberate, and documented rather than hidden.

## ADR-019 — The media row is the ledger; the bytes follow it

**Decision.** `media_object.pending_deletion_at` makes every stored object either
*claimed* or *scheduled for deletion*. Bytes are written before the row exists and
deleted before the row is removed. A daily sweeper reconciles.

**Why.** A database transaction and an object-store write cannot be made atomic.
Rather than pretend otherwise with compensating logic that is wrong in the
interesting cases, the design makes both failure directions harmless:

- **Upload, then abandon the form.** The object was born with a deadline and
  nobody cleared it, so the sweeper collects it. No orphan.
- **Remove, then storage fails.** The row survives, still scheduled, and
  `getAuthorizedMedia` already refuses anything pending deletion. The sweeper
  retries. No unreachable bytes, and nothing readable that should not be.

Row-first deletion was rejected: it leaves bytes nothing knows about, which for a
private photograph of a child is the one outcome worth engineering against.

**Consequence for replacement.** The profile re-points and the old object is
scheduled in a single commit — transactional from the application's point of
view. Only the byte cleanup is eventual, and it can only ever run late, never
early, and never on an object something still points at.

**Cost.** An object can outlive its usefulness by up to a day if the cron does not
run. That is why the sweep is daily rather than weekly, and why removal and
replacement also purge inline rather than relying on it.

## ADR-020 — Version 1 of the catalogue removes fields rather than hiding them

**Decision.** ISBN, publisher, language and description are **dropped** from
`book_title` in migration 4, not left as unused nullable columns. The catalogue
stores eleven things and no more.

**Why.** A nullable column nobody fills in is not neutral: it is a field a future
screen grows back by accident, and "it was already there" is how a one-minute
form becomes a fifteen-field one. The people cataloguing this collection are
volunteers and, in time, children; every field they do not have to answer is a
book that actually gets on the shelf.

Re-adding any of them now costs a migration and a decision. That is the right
price for a change that makes the form longer.

**Enforcement.** `tests/unit/catalogue.test.ts` reads `schema.prisma` and asserts
each field's absence. Adding one requires deleting a line from a test, which is a
conversation rather than a commit.

**Cost.** If the library ever wants ISBN lookup, it is a migration away rather
than a column away. Judged worth it: the alternative is carrying eleven dead
columns on the guess that one of them might be wanted.

## ADR-021 — Book covers are stored private, with a different rule from child photographs

**Decision.** A book cover goes through the identical storage pipeline as a
child's photograph — same validation, same generated key, same metadata
stripping, same `PRIVATE` visibility, same lifecycle — but `getAuthorizedMedia`
answers a **separate, explicitly written branch** for it: any signed-in member
may see any cover, and a signed-out visitor may too when
`catalogue_visibility` is `PUBLIC`.

**Why private storage.** A book jacket is not sensitive. But the catalogue
defaults to MEMBER_ONLY, and a public CDN URL is a way around the front door
that no later permission check can close. Keeping every read behind
`/api/media/[id]` means the answer to "who may see the shelf?" lives in one
setting rather than in whichever URLs have leaked.

**Why a separate branch rather than a shared rule.** The single mistake that
would matter most here is a change intended for book covers quietly loosening
what applies to a child's photograph. Two branches that share no condition
cannot do that. `claimUnclaimedBookCover` is likewise scoped by purpose, so a
book form carrying a child photo's media id is refused.

**Cost.** Covers are not CDN-cached and are re-read from the object store on
every request. At this scale — tens of books, a handful of concurrent readers —
that is cheaper than the class of mistake it prevents.

## ADR-022 — There is no delete in the catalogue, and no counter on a donation

**Decision.** Two absences, treated as architecture rather than as scope:

1. **No delete.** A book that leaves the shelf is `LOST`, `DAMAGED` or
   `ARCHIVED`. No service function removes a `book_copy` or a `book_title`.
2. **No count, total, rank or score on a donation.** Not in the schema, not in
   the service, not in a projection.

**Why no delete.** Somebody in this community gave that book. The record of the
gift outliving the object is the point, and a busy desk plus a delete button is
how a donation from three years ago disappears because a spine fell off.

**Why no counter.** A leaderboard turns a gift into a scoreboard, and a family
who cannot afford to donate would feel it every time they opened the page.
Donating is never a condition of membership, and the thank-you page must not
quietly reintroduce one.

The enforcement is structural rather than editorial: **there is no column to hang
a leaderboard on**, and `DonorCredit` carries exactly one field — the sentence to
render. Adding "sort by generosity" would require first adding a number that
deliberately does not exist. A test asserts both.

**Cost.** "How many books has the library received?" needs a query rather than a
column. Acceptable: that question is asked once a year, by an adult, and does not
need to be on a child's screen.

---

## ADR-023 — Books and readers get separate code namespaces, for humans only

**Decision.** `copy_code_prefix` and `member_code_prefix` carry a letter naming
the kind of thing the code refers to: `MJCL-B0007` is a book on the shelf,
`MJCL-R0007` is a child's library card. Platform defaults are `LIB-B` and
`LIB-R`. The two sequences remain independent, as they always were.

**Why.** Books were briefly labelled in the readers' namespace, on the argument
that a volunteer should learn one shape rather than two. Because the sequences
are independent, that made a collision certain rather than possible: the seventh
book and the seventh card spelled the same string. Two costs followed. Every
spine in the room displayed a string that was also a valid card number, which
against 8-character member passwords (ADR-013) left the password as the only
unknown half of a sign-in. And "look up MJCL-R0007" had two answers, which is
exactly the ambiguity a desk full of children does not need.

**What the letter is not.** It is not an authorization signal and must never
become one. No code path may decide what a record is by parsing a prefix.
`member_code` and `copy_code` are columns on different tables and are only ever
queried by column: `findUserByIdentifier` reads `member_profile` and cannot
return a book; catalogue lookup reads `book_copy` and cannot return a child. If
the two prefixes were made identical again tomorrow, authorization would be
exactly as sound — the tests assert the table boundary, not the string shape.

**Cost.** A volunteer learns two shapes instead of one. Books catalogued under
the old labels had to be renamed, which is only tolerable because it happened in
development, before any label was printed. A code is a permanent physical
sticker; the deployed system must never rewrite one.

**Verified.** A book and a card at the same number are different strings; 25
concurrent book allocations yield 25 distinct codes; a book's own code offered
as a login identity finds nobody; and the code a book used to carry no longer
resolves to it, in search or at its URL.

---

## ADR-024 — The database owns "borrowed", via a deferred constraint trigger

**Decision.** The rule *a copy reads BORROWED if and only if it has exactly one
ACTIVE loan* is enforced by a pair of `CONSTRAINT TRIGGER`s declared
`DEFERRABLE INITIALLY DEFERRED`, not by application code alone.

**Why.** This is the one invariant the whole of circulation rests on, and it is
the one a CHECK constraint cannot express: a CHECK may only look at the row it
is checking, and this rule is about a `book_copy` row and a `loan` row agreeing.
Left to the service layer it would hold until the first refactor, the first
`psql` session, or the first raced request. `AVAILABLE + active loan` and
`BORROWED + no loan` are the two states that make a library's own records
untrustworthy, and they should be unrepresentable rather than merely unlikely.

**Why deferred.** Issuing a book creates a loan and updates a copy, and one of
those necessarily happens first. An immediate trigger would reject a perfectly
correct transaction halfway through. Deferring to `COMMIT` applies the rule to
the end state — which is the state that matters — while remaining inescapable,
because a transaction that would leave the database incoherent simply does not
commit.

**Alternatives.** Application-only checks (fail on any bypass); a materialised
`has_active_loan` column with its own drift problem; making `book_copy.status`
a view over `loan` (loses LOST, DAMAGED and ARCHIVED, which are facts about a
physical object and not about circulation).

**Cost.** A violation surfaces at commit rather than at the offending statement,
so the raw error names no statement. The services check first and raise
something a librarian can read; the trigger is the net underneath them, not the
first line. Tests that build loan rows by hand must now build coherent ones —
three Phase 0 constraint tests were rewritten for exactly this reason, and are
better for it.

**Consequence.** `BORROWED` left `SELECTABLE_STATUSES`. A dropdown that could
set it would be a borrowed book with no borrower, and the database would refuse
the write anyway.

---

## ADR-025 — Overdue is derived at read time and has no representation anywhere

**Decision.** No `is_overdue` column, no `OVERDUE` loan status, no nightly job
that marks anything. A loan is overdue when `status = 'ACTIVE' AND due_at < now()`,
evaluated in the library's configured timezone at the moment somebody asks.

**Why.** A stored overdue flag is only as correct as the last successful run of
whatever sets it. On a volunteer-run system with no operations staff, the failure
mode is a library that believes something untrue about a child — and the person
who finds out is the child being told to bring back a book they returned. A
derived answer cannot be stale, becomes true at midnight with nothing running,
and becomes false the instant a book is returned.

**Alternatives.** A cron job flipping a flag (the failure above); a materialised
view (same staleness, more machinery); a generated column (Postgres generated
columns must be immutable, and `now()` is not).

**Cost.** Every "is this late?" read does the comparison. It is one indexed
predicate against a partial index over active loans only, which stay a rounding
error next to returned ones. `LoanStatus` is therefore three values and reads
oddly to anyone expecting a fourth.

**Enforced.** A test asserts no column matching `%overdue%` exists on `loan`,
`loan_event` or `book_copy`, and that `LoanStatus` is exactly
`ACTIVE, RETURNED, CANCELLED`. The only matches anywhere are reminder
configuration on `library_settings`.

---

## ADR-026 — `loan.view` is shared with readers, so it may never guard a staff screen

**Decision.** One permission key, `loan.view`, is held by every staff role **and
by every reader**. What differs is not the key but the function: the reader's
view is `listOwnLoans()`, which takes no member id and reads the session. The
desk's queries require `["loan.issue", "loan.return", "loan.renew"]`.

**Why.** A child seeing their own books is a read of loans, and inventing a
second key (`loan.view_own`) would put the ownership rule in the permission
system, where it would be one forgotten check away from leaking. Putting it in
the *shape of the function* means there is no "whose loans?" parameter to get
wrong and no id in a URL to increment. The strongest form of "you reach your own
record and no other" is having nothing to tamper with.

**The trap this creates, written down deliberately.** Because every reader holds
`loan.view`, guarding a desk screen with it would hand any nine-year-old the
whole library's loan list with every borrower's name on it. This is exactly the
mistake `book.view` invited in Phase 2 — `book.view` is what lets a child browse,
so the staff catalogue screens require `book.create`/`book.edit`/`book.archive`
instead. The rule generalises: **a permission that readers hold can never guard a
staff surface.**

**Alternatives.** Separate `loan.view_own` and `loan.view_all` (moves ownership
into RBAC, where it is weaker); deciding by `actor.kind === "MEMBER"` (authorization
by user kind rather than by permission, against ADR-006).

**Cost.** The rule has to be known. It is stated in `permissions.ts`, in the
service, in `CIRCULATION.md` §12, and asserted by a test that a member cannot
reach `listLoansForStaff`, `countDeskLoans`, `searchReaders` or `searchCopies`.

**Corollary.** Readers hold no circulation *mutation* permission at all. A test
asserts every permission a member holds ends in `.view`.

## ADR-027 — A deployment may not decide where a physical book is

**Decision.** Migration 6 refuses to run while any copy reads `BORROWED` with no
active loan. It installs `circulation_assert_no_stranded_copies()`, calls it
first, and stops there. It does not reset the copy, does not create a loan, and
writes nothing on the library's behalf. Resolving those books is an explicit,
per-copy, audited act performed by a person through
`npm run reconcile:circulation`, with three possible outcomes: on the shelf
(`AVAILABLE`), a named child has it (a real loan, with the operator's dates), or
whereabouts unknown (`LOST`).

**Why.** The state is a question about the physical world — where is this book? —
and a deployment has no way to answer it. Both automatic answers are assertions
the software cannot support:

* `AVAILABLE` says the book is on the shelf. It may be in a child's bag, and the
  next reader is then promised a book nobody can hand them.
* A loan says a particular child has it. Nothing in the database knows who, and
  the invented borrower would sit in a real child's borrowing history
  permanently, in a system whose whole premise is that history is not rewritten.

Refusing is only viable because there is an honest third answer. `LOST` already
exists in `CopyStatus`, is coherent with the invariant trigger, promises the book
to nobody, and names no child. Without it an operator with a genuinely missing
book would be forced to pick a lie.

**What changed.** The first implementation of Phase 3 reset such copies inside
the migration and wrote an audit row naming each one. That was a defensible
handling of a known demo fixture and an indefensible deployment behaviour, and
conflating the two was the actual error: development knew what that record was,
production does not. The demo record is still reset — now by a person, using the
same tool, having said so.

**Cost.** An upgrade can fail on a database nobody has prepared, and the failure
is at deploy time rather than at a desk. That is the trade being made: a
deployment that stops is recoverable in minutes, and a book quietly declared
available is discovered by a child who was promised it.

**Verification.** `tests/database/circulation-reconciliation.test.ts` constructs
the state by disabling the invariant trigger for one statement — nothing in the
application can produce it — then asserts the guard raises, names the book,
leaves the copy `BORROWED`, and creates no loan and no loan event. Two further
tests read the migration file itself and assert it contains no statement writing
`book_copy` and no `INSERT INTO audit_log`.

## ADR-028 — Borrowing is an allowlist of one account state

**Decision.** Only an `ACTIVE` member may borrow or renew. The rule is
`BORROWING_ALLOWED_STATUSES = ["ACTIVE"]` in `src/lib/circulation.ts`, and it is
enforced inside the issue and renew transactions after the member's row is
locked — never by the screen.

**Why written as an allowlist.** Phase 3 first shipped this as a denylist of
`SUSPENDED`, `DEACTIVATED`, `ARCHIVED`, which let `INVITED` borrow. That was
wrong on its merits — an invited account is one whose guardian has not completed
activation, so nothing has yet confirmed the child is enrolled on the terms the
family agreed to, and lending first is exactly the ordering a children's library
should not adopt. But the shape was the deeper problem: a denylist has to be kept
in step with the enum, and a state added later inherits the right to borrow by
default. An allowlist fails the safe way — a new state cannot borrow until
somebody argues for it in that file.

**One sentence for every refusal.** "This library account is currently
unavailable for borrowing." Which state a family is in is their business and a
conversation; a desk screen that distinguished *invited* from *suspended* would
narrate it to whoever is standing at the counter. A unit test asserts the
sentence contains no state name.

**Cost.** A librarian holding a book and a child who cannot borrow it gets no
explanation from the message. They have a route to one — `/desk/members` shows
"Waiting to set up" — and the remedy for the common case is theirs to apply in a
minute: finish the activation, then lend the book.

**Verification.** All five states are issued against in
`tests/database/circulation.test.ts`, and all five are renewed against; the unit
suite asserts the allowlist has exactly one member and that filtering every
`UserStatus` through `memberMayBorrow` yields `["ACTIVE"]`.

---

## ADR-029 — A reminder is claimed before it is sent, keyed by the loan's own due date

**Decision.** Every due-soon and overdue message is claimed as a row in
`loan_notification` before it reaches an email provider, unique on
`(loan_id, due_at, offset_days)`. The daily job derives which occurrence is due
from the loan's **current** due date, in the library's timezone.

**Why.** This library charges no fines and can compel nobody, so a polite note
to a parent is quite literally the whole mechanism by which books come back. A
reminder that arrives every morning is not a reminder — it is a thing people
filter — and at that point the library has no mechanism at all. The daily cron
runs every day and may run twice; duplicate suppression therefore cannot be an
optimisation, it is the feature.

**Why the insert is the lock.** A check-then-insert in application code has a
window between the halves, and two Vercel cron invocations — or one cron and an
operator running the job by hand — would both walk through it. Two inserts of
the same occurrence cannot both commit, so the loser simply skips. Tested with
genuinely parallel runs against real PostgreSQL.

**Why `due_at` is in the key.** It is what makes renewal work with no
cancellation logic anywhere. Renewing moves the due date, which retires every
occurrence belonging to the old one and leaves the new date's occurrences
unclaimed. Nothing has to remember to cancel a scheduled message, because
nothing was ever scheduled — the job asks the loan, every morning, where it
stands now.

**Alternatives.** A `next_reminder_at` column on the loan (a stored schedule
that a renewal must remember to update, and that a failed job leaves wrong); a
provider-side dedupe key (moves a correctness guarantee outside the database and
outside the tests); scanning `email_event` for a prior send (no constraint, so
it races).

**Cost.** A failed delivery is not retried: the occurrence is spent and the row
reads `FAILED`. A family may miss one note. The alternative is worse — a
provider that reports a failure it actually delivered would produce a second
copy the next morning, and the desk's overdue list never depended on email
anyway.

**Verification.** `tests/database/notifications.test.ts` — the same day twice,
two jobs at the same instant, a renewal in between, and an assertion after a run
that the loan's status, due date, renewal count, borrower, book status and event
history are all byte-for-byte unchanged.

---

## ADR-030 — Approving a renewal request runs the desk's own renewal, under `loan.renew`

**Decision.** `decideRenewalRequest` calls `renewLockedLoan` — the same function
the desk's Keep-longer button calls — inside one transaction with the decision,
and is guarded by `loan.renew`. No new permission was introduced for deciding a
request. A child holds `loan.request_renewal`, which permits asking only.

**Why one code path.** A second implementation of renewal would be a second
place for the renewal rules to live, and the two would drift: a rule added to
one — the overdue policy, the allowance, an eligibility check — would silently
not apply to the other. Extracting the core so both callers arrive at it holding
the loan's lock costs one function and removes that whole class of bug.

**Why not a separate permission.** Approving a request does exactly what the
desk button does. `loan.decide_renewal_request` would name the same power twice,
would be granted to exactly the same roles, and would eventually be granted to
one of them and not the other by mistake. Junior Librarian already holds
`loan.renew`, which is right: answering a child's question is desk work, and
that is the role's whole purpose.

**Why the rules are re-checked at decision time.** A request raised on Monday
can be answered on Wednesday. The book may have gone overdue, the allowance may
have been spent at the desk, the account may have been paused. The check when
the child asks exists so they are told a knowable "no" immediately; the check at
approval is the one that decides.

**Why a refused approval leaves the request PENDING.** The librarian has learnt
something the child could not know. Declining is a decision a person makes, with
a note attached; marking it declined automatically would attribute that decision
to nobody. A `renewal_request.refused` audit row records the attempt.

**Cost.** `renewLockedLoan` takes a transaction client, an actor and a settings
object rather than opening its own transaction, so a future caller could get the
lock ordering wrong. There are two callers, both in the same file, and both
arrive through `lockActiveLoan`.

**Verification.** `tests/database/renewal-requests.test.ts` — parallel
approvals, approve-versus-decline, a desk renewal racing an open request, and an
overdue loan answered late. In every case: one renewal, one `RENEW` event, one
decision.

---

## ADR-031 — A child's action is keyed by the book code, not by a loan id

**Decision.** The reader-facing renewal actions take a `copy_code` — the string
printed on the book — and resolve it against `member_user_id = the session`. No
loan id, member id or library id appears in any reader-facing form.

**Why.** It removes the question rather than answering it. There is no id on the
page to increment, no ownership check to remember, and no field a curious
nine-year-old can edit into somebody else's record — the same shape that makes
`listOwnLoans` take no parameters at all (ADR-026's sibling reasoning). The code
is also what the child is holding, so it is the natural thing for their screen
to send.

**One sentence for every miss.** A code that does not exist, one belonging to
another child, and one already brought back all return *"We could not find that
book on your shelf."* A child probing codes learns nothing about which are real
or who has them.

**Cost.** A book code is not unique across libraries in principle, so the lookup
is scoped by library as well as by member — which it would have to be anyway.
A child holding two copies of the same title cannot exist (two copies have two
codes), so the resolution is unambiguous.

**Verification.** `tests/database/renewal-requests.test.ts` — another child's
book, a fictional code, and a returned book all produce the identical refusal,
and a second reader's screen never contains the first's request.

---

## ADR-032 — Reminders ship switched off, and three carried questions are settled

**Status.** Owner decision, 18 August 2026. This record does not change anything
ADR-029, ADR-030 or ADR-031 decided; it closes questions those records left for
the owner, and it supersedes the corresponding open items in `docs/PHASE-3.md`
§4 and `docs/PHASE-4.md` §7, which now point here.

**Decision 1 — `overdue_reminders_enabled` stays `false`.** The notification
system is built, tested and reachable, and it sends nothing. It stays that way
until four things are true: a production email provider is configured, a sending
domain exists, SPF and DKIM are published for it, and the consent and privacy
questions about writing to guardians are settled.

**Why.** Every one of those four is a precondition for a message that reaches a
parent's inbox rather than their spam folder — and the last is a precondition for
the library being allowed to send it at all. A switch that is off is the honest
representation of a feature whose prerequisites are unmet. Nothing is stubbed,
nothing pretends, and the day the four are true the change is one `UPDATE`.

**What "off" means, precisely.** `library_settings.overdue_reminders_enabled`
defaults to `false` in the schema and is deliberately **not written by the
seed** — a value absent from `prisma/seed/library-config.ts` cannot be turned on
by re-running a seed. `sendCirculationReminders` returns
`{ enabled: false, due: 0, sent: 0, … }` and claims nothing, so no
`loan_notification` row exists to make a later run think a message was already
handled. In development, mail is captured to `.mail/` and read at `/dev/mail`;
no real message has ever left this application.

**Decision 2 — `renewal_period_days` is 14, and this is final.** It matches the
worked example the library runs on: issued 17 August, due 31 August, renewed to
14 September. The platform default of 7 stands for other deployments. This is no
longer an open question in `docs/PHASE-3.md` §4.

**Decision 3 — the internal state stays `DECLINED`.** The enum shipped in
migration 1 with that word and keeps it; no migration. The brief's "REJECTED" is
a synonym, and renaming a state that appears in a database, a Prisma enum, an
audit action and a test suite in exchange for a synonym is a migration bought
with nothing. Child-facing wording stays friendly and stays separate from the
enum — the screen says **"Not this time"**, and a declined ask reads *"The
librarian would like this one back. Please bring it in."* The librarian's note is
never shown to the child.

**Decision 4 — retry and delivery tracking are production-readiness work, not
Phase 4 work.** Two gaps are documented and deliberately unclosed: a claimed
occurrence that fails to send is not retried, and a crash between claiming and
sending leaves a `QUEUED` row that nothing surfaces. Both are stated in
`docs/NOTIFICATIONS.md` §4 and `docs/OPERATIONS.md`. No queue, worker, second
provider or delivery dashboard was added — building retry machinery for a
feature that is switched off would be inventing operational behaviour before the
operation exists.

**Cost.** The library gets no reminders until somebody decides it should. That
is the intended cost: the decision to start writing to families belongs to the
community, not to a default.

**Verification.** `tests/database/notifications.test.ts` asserts the disabled
path sends nothing and claims nothing, and that a send cannot alter a loan.
`tests/unit/circulation.test.ts` pins the settings a deployment actually reads.
