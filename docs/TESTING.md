# Testing

**188 tests** at the end of Phase 1: 84 unit, 104 against a real PostgreSQL.
(Phase 0 ended at 110.)

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

- **No browser end-to-end suite.** Both phases' flows were verified manually
  against the running application — Phase 1 included the whole journey from
  `/join` through approval, the emailed link, activation and child sign-in.
  Playwright is the right next step now that there are real forms to drive.
- **No automated accessibility assertions.** Contrast was measured numerically
  and recorded in `DESIGN_SYSTEM.md`; axe should run in CI once there are forms
  and tables worth scanning.
- **No load or soak testing.** Not warranted at this scale.
