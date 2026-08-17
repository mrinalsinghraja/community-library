# Testing

**252 tests** at the end of Phase 1.1: 107 unit, 145 against a real PostgreSQL.
(Phase 0 ended at 110; Phase 1 at 188.)

The guiding rule: **do not write tests that assert the mock works.** The most
important guarantees in this system live in the database, so they are tested
against a database.

---

## Two suites

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| `unit` | `npm test` | nothing | Pure logic: dates, permissions, password policy, upload validation, audit redaction, code formatting |
| `database` | `npm run test:db` | `TEST_DATABASE_URL` | Constraints, concurrency, sessions, access isolation |

`npm run test:all` runs both. CI runs both, plus a build.

The database suite refuses to start without `TEST_DATABASE_URL` rather than
guessing — it truncates every table in whatever it is pointed at.

## What the unit suite proves

**Dates** (`tests/unit/dates.test.ts`) — the due date is computed in the
library's timezone, not the machine's; a book issued at 9am and one at 6pm are
due the same day; 20:00 UTC is already tomorrow in Kolkata and counts from
tomorrow; overdue flips only after the due day ends; the borrowing period is
never hard-coded to 14; late wording contains no punitive language.

**Permissions** — Super Admin holds every permission; a librarian can never hold
settings, roles, staff management, audit or deletion; the seeded Junior
Librarian role can never hold guardian contact details, password actions,
settings or deletion. That last one exists so a future edit cannot quietly widen
a role held by a child volunteer.

**Passwords** — an eight-character secret word is accepted for a member and
refused for staff; the six-character words Phase 0 allowed are now rejected;
common passwords are blocked case-insensitively; the library's own name and the
person's own name are refused (from configuration, not a hard-coded list);
hashes are argon2id and salted; a corrupted hash reads as a failed login, not a
500.

**Uploads** — an ELF binary renamed `.jpg` is rejected on its bytes; shell
scripts and zips are rejected; a lying `Content-Type` is ignored; SVG is refused
for anything a parent can upload; the storage key never contains the user's
filename; two identical uploads get different keys but the same checksum.

**Audit redaction** — passwords, hashes, tokens, API keys, SMTP passwords and
connection strings are stripped, including nested and across key casings.

## What the Phase 1 suites prove

**Registration** (16) — a pending request creates no account; consent is stored
with a verbatim snapshot; age is enforced at both ends *and* re-checked at
approval; a duplicate is swallowed silently; approval creates member, card,
guardian link and activation token in one transaction; rejection keeps the
internal reason internal; a member cannot reach the queue.

**Activation and reset** (24) — valid, expired, reused, revoked and unknown
tokens; issuing a new link kills the old one; the policy applies at activation
and the token survives a rejected attempt; reset mail goes to the guardian;
unknown identifiers produce silence; throttling is silent; password change ends
every session.

**Authorization** (20) — a member cannot list members or staff, suspend anyone,
create staff, or change guardian contact details. A librarian cannot list staff,
create staff, change roles, or reach a Super Admin **through the member
service**. A Super Admin cannot suspend or demote themselves, and the last
active Super Admin cannot be removed. Contact details are stripped by the
service. No payload contains a password hash.

**Email templates** (14) — no template contains a password; names are escaped
against injection; the rejection email omits the internal reason; the suspension
email omits why; the staff invitation does not tell a librarian their child is
now a member.

## What the Phase 1.1 suites prove

**Guardian verification** (20, `tests/database/guardian-verification.test.ts`) —
a submission creates two consent records *and* one verification record, and the
verification calls a tickbox exactly what it is worth; the database refuses to
store `SELF_DECLARED` at `IDENTITY_PROVIDER` strength, refuses a verification
attached to nobody, and refuses a staff confirmation that does not name the staff
member; the queue reports consent and verification as two independent states,
including the case where consent is complete and verification is not; approval is
refused when the requirement is unmet and the request **stays pending** with no
account created; recording an in-person confirmation reopens it; raising the
requirement after approval blocks activation, leaving the account `INVITED` with
no password; the evidence moves onto the member and guardian at approval; the
emailed challenge is single-use, expires, stores only a SHA-256, and its hash is
cleared when spent so a replay matches nothing at all; a member cannot record a
verification; a note is required and one long enough to hide a document in is
refused.

**Child photographs** (20, `tests/database/media-access.test.ts`) — a signed-out
visitor, and any child who is not the subject, get `NotFound` and **the same
answer as for an id that never existed**; the child themselves and a librarian
can read it; an object pending deletion reads as gone; an ELF binary named
`.jpg`, an oversized file and a traversal-shaped filename are all refused, and
nothing reaches storage when validation fails; a media id that already belongs to
somebody cannot be claimed by a new registration; removal clears the profile,
deletes the row and the bytes, keeps the avatar and writes an audit row naming
the object but not its key; a member without the permission is refused;
replacement re-points the profile, removes the old row and bytes, and leaves the
existing photo untouched when the new file is invalid; the member photo service
refuses to reach a staff account; when the object store fails the row survives,
scheduled, and the sweeper finishes the job; the sweeper collects unclaimed
uploads, leaves claimed ones alone, and reports rather than retrying forever.

**Verification policy** (unit) — the strength ordering is strictly increasing and
an unknown value throws rather than scoring zero; a self-declaration never
satisfies any real requirement; `OTHER` is worth nothing by default; and the
development banner's wording is asserted so a later edit cannot soften it.

## What the database suite proves

**The double-issue guard** — two concurrent `Promise.allSettled` inserts of the
same copy: exactly one succeeds, one active loan remains. This is the test that
justifies the partial unique index; a mock could not fail it.

**Code allocation** — 40 parallel allocations produce 40 distinct consecutive
values; a failed surrounding transaction rolls the reservation back rather than
burning a code; the two kinds of sequence stay independent.

**Session revocation** — suspend a member and their live session resolves to
null on the next call, with the rows deleted; both idle and absolute expiry are
enforced; idle refresh never pushes past absolute expiry (which would violate a
CHECK constraint and turn a page load into a 500).

**Child isolation** — a reader reaches their own record; asking for another
child's id raises `NOT_FOUND`, identically to asking for an id that does not
exist at all; a reader's permissions resolve to exactly `book.view`; a grant of
the non-assignable Junior Librarian role confers nothing.

**Constraints** — every CHECK described in `DATABASE.md` §3 has a test, both
that it rejects the bad case and that valid data still passes.

## Tests that caught real bugs during Phase 0

Worth recording, because they justify the effort:

1. **Idle-expiry clamp.** `resolveSession` refreshed idle expiry to
   `now + idleTTL` without bounding it by absolute expiry. Late in a member's
   7-day session that violates `session_idle_within_absolute` and 500s an
   ordinary page load. Found while writing the test; fixed with a clamp.
2. **Code separator.** `formatCode("MJCL-R", 42, 4)` produced `MJCL-R-0042`
   while the seed created `MJCL-R0001`. Two different formats for the same card.
   Found by reading the rendered login hint; fixed with an explicit rule and a
   test.
3. **A dropped index.** `prisma migrate dev` silently removed the trigram index
   on the following migration. Found by inspecting the generated migration; the
   index is now expression-based, and CI fails on drift.
4. **Personal details matched too literally.** `"Rosalind Chen"` failed to block
   `rosalind99` because the check compared the whole string. A child uses their
   first name; the check now splits into words.
5. **The rate limiter caught its own test suite.** Reset tests sharing one IP
   silently starved each other at the 5-per-hour cap — the limiter working
   exactly as intended. Each test now uses a distinct address, and the throttle
   gained its own test.

## And in Phase 1.1

6. **The existing suite caught the new activation gate immediately.** Four
   Phase 1 tests broke because `createMember` built accounts with no verification
   record at all — accounts no real workflow could produce. The right fix was the
   fixture, not the rule: **absence of evidence is the weakest state, not an
   exemption.** The helper now records a verification the way approval does, and
   a dedicated test strips the records to prove a valid activation link alone is
   not enough.
7. **A header the code claimed but did not deliver.** The media route sets
   `default-src 'none'; sandbox`, but `src/proxy.ts` was overwriting it with the
   page CSP, so children's photographs were served under the application's script
   policy. Found by probing the live response in the browser — reading the route
   file would never have shown it. `api/media` is now excluded from the matcher.

## Running one file

```bash
npx vitest run --project unit tests/unit/dates.test.ts
npx vitest run --project database tests/database/constraints.test.ts
npx vitest --project unit          # watch mode
```

## A note on the auth stub

Database tests alias `@/server/auth` to `tests/stubs/auth-stub.ts`, because
next-auth imports `next/server`, which only resolves inside a Next.js build.

What is replaced is deliberately tiny: **only the boundary that reads the
cookie**. Resolving the handle against the session table, checking account
status, and computing permissions from the database are all the real code. A
test that stubbed the authorization layer itself would be worthless.

The alias is an anchored regex, ordered before the general `@/` mapping —
otherwise `@` matches first, or `@/server/auth` swallows
`@/server/auth/session-store`. Both mistakes were made on the way here.

## Not yet covered

Honest gaps at the end of Phase 1:

- **No browser end-to-end suite.** Every phase's flows were verified manually
  against the running application — Phase 1.1 included registration with and
  without a photograph, the librarian's queue, photo replace and remove, the
  production gate closing and reopening, and cross-child photo isolation.
  Playwright is the right next step now that there are real forms to drive.
- **Images are not re-encoded or resized.** Metadata is stripped (see
  `MEDIA.md`), but the pixel data is stored as uploaded, so a 5 MB photograph
  stays 5 MB. Thumbnailing needs a native image library and has not been judged
  worth the dependency at this scale.
- **No automated accessibility assertions.** Contrast was measured numerically
  and recorded in `DESIGN_SYSTEM.md`; axe should run in CI once there are forms
  and tables worth scanning.
- **No load or soak testing.** Not warranted at this scale.
