# Testing

110 tests at the end of Phase 0: 66 unit, 44 against a real PostgreSQL.

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

**Passwords** — a six-character secret word is accepted for a member and refused
for staff; common passwords are blocked case-insensitively; the library's own
name (from configuration, not a hard-coded list) is refused; hashes are argon2id
and salted; a corrupted hash reads as a failed login, not a 500.

**Uploads** — an ELF binary renamed `.jpg` is rejected on its bytes; shell
scripts and zips are rejected; a lying `Content-Type` is ignored; SVG is refused
for anything a parent can upload; the storage key never contains the user's
filename; two identical uploads get different keys but the same checksum.

**Audit redaction** — passwords, hashes, tokens, API keys, SMTP passwords and
connection strings are stripped, including nested and across key casings.

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

## Running one file

```bash
npx vitest run --project unit tests/unit/dates.test.ts
npx vitest run --project database tests/database/constraints.test.ts
npx vitest --project unit          # watch mode
```

## Not yet covered

Honest gaps at the end of Phase 0:

- **No browser end-to-end suite.** Phase 0's flows were verified manually
  against the running application (sign-in, redirect, suspension, headers, cron
  auth, responsive layout). Playwright arrives with the registration and
  circulation flows, which is where it earns its keep.
- **No automated accessibility assertions.** Contrast was measured numerically
  and recorded in `DESIGN_SYSTEM.md`; axe should run in CI once there are forms
  and tables worth scanning.
- **No load or soak testing.** Not warranted at this scale.
