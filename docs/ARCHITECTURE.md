# Architecture

A modular monolith on Next.js. One deployable application, strict internal
boundaries, no microservices, no queues, no extra infrastructure.

---

## 1. Layers

```
  src/app/          pages and route handlers (React Server Components)
  src/components/   presentation only
        │
        │  may call
        ▼
  src/server/actions/     server actions: parse input → call a service
        │
        │  may call
        ▼
  src/server/services/    ALL business rules live here
        │                 • requirePermission() first, always
        │                 • audit row in the same transaction as the change
        │  may call
        ▼
  src/server/lib/         settings · codes · crypto · password · tokens
                          uploads · storage · email/ · audit · rate-limit
  src/server/repositories/  library-scoped data access
        │
        ▼
  src/server/db.ts        Prisma
```

Phase 1 services: `registration-service` · `password-service` ·
`account-service` · `staff-service`. Each one opens with
`requirePermission(...)` and audits inside the same transaction as its change.

`src/server/page-guards.ts` sits beside them but is **not** part of the
boundary: it turns a denial into a redirect instead of a crash page. The deny
has already happened by then (ADR-016).

**The rule that keeps this true:** components, pages and server actions may not
import `@prisma/client` or `@/server/db`. This is enforced by
`no-restricted-imports` in `eslint.config.mjs`, so violating it fails CI rather
than slowly rotting. It already caught one violation during Phase 0 (a health
route reaching straight for the database).

Why it matters: if business rules *can* be written inside a page, they will be —
in five places, three of which will forget the permission check.

## 2. Three invariants for every service function

1. **`requirePermission(...)` before any work.** An unauthorized call must have
   no side effects, so the check comes before the first write.
2. **Scope by `libraryId`.** Every tenant-scoped table carries it; nothing reads
   across libraries.
3. **Audit in the same transaction.** If the change rolls back so does its
   record; if it commits, the record cannot be missing.

## 3. Request flow

```
Browser
  │
  ├─► src/proxy.ts (edge)
  │     • presence of a session cookie → redirect if absent
  │     • Content-Security-Policy with a per-request nonce
  │     ⚠ NOT authorization: the edge has no database access, so it cannot tell
  │       a valid cookie from a forged one. It is a tidiness gate only.
  │
  ├─► React Server Component
  │     • getActor()  ← resolves the session handle against the database,
  │                     re-reads user status, re-computes permissions
  │     • renders only what this actor may see
  │
  └─► Server Action (mutations)
        • zod parse
        • service call → requirePermission → rules → write + audit
        • revalidate
```

`getActor()` is wrapped in React's `cache()`, so a page rendering twenty
components performs one session lookup and one permission query, not twenty.

## 4. Authentication

Auth.js v5 with the Credentials provider handles the sign-in route, CSRF, and
cookie encryption. It does **not** decide authorization.

Sessions are our own table. The cookie carries an opaque random handle and
nothing else — no roles, no identity claims, no permissions. Every request
resolves that handle against `session`, checks both expiries, and checks the
user is still `ACTIVE`.

This design exists because of a constraint verified in the installed source
(`@auth/core/lib/actions/callback/index.js`): the Credentials provider always
issues a token cookie and never calls `adapter.createSession`, so native
database sessions are unreachable from any password login. Full reasoning in
ADR-009.

The property this preserves — and it is the one that was actually asked for —
is that suspending an account ends its live sessions immediately. Verified end
to end in Phase 0: suspend a member, and the very next request with their
existing cookie redirects to sign-in with zero session rows remaining.

## 5. Authorization

Permissions are rows, not code branches.

```
role ──< role_permission >── permission
 │
 └──< user_role >── app_user
```

`src/lib/permissions.ts` is the source of truth for the catalogue and the
role→permission mapping; the seed reconciles the database against it on every
run. Adding **Junior Librarian** later is a seed change and nothing else — the
role is already seeded, with `isAssignable = false`, and a test asserts it can
never hold guardian contact details, password actions, settings or deletion.

Ownership is separate from permission. A member holding `book.view` still only
ever resolves *their own* loans, because services take the member id from the
session and never from the request. Probing another child's id returns
`NotFound`, not `NotAuthorized`, so the response cannot confirm that an id
is real.

## 6. Configuration over hard-coding

```
environment variables  →  infrastructure only (connection strings, secrets)
library_settings row   →  everything a librarian or admin might change
seed data              →  permissions, roles, categories, the community itself
code constants         →  only genuinely invariant things (enum values)
```

Every business rule reads from `getLibrarySettings()`. There is no `14` and no
`5` in business logic, and no community name in any component.

`prisma/seed/library-config.ts` is the **only** file in the repository that
names a specific community. An ESLint rule forbids those literals anywhere
under `src/`; it caught two real violations during Phase 0 (a login hint and a
password blocklist entry), both of which now read from configuration.

Branding is injected as CSS custom properties in the root layout, so changing
the primary colour in admin restyles the application with no deploy.

## 7. Multi-community readiness

Every scoped table carries `library_id` from the first migration, and
`getCurrentLibrary()` is the single resolution point. Version 1 runs one
library; a second becomes a lookup by host or slug, not a migration.

No multi-tenant machinery has been built. Row-level security is deliberately
not used: the browser never talks to the database, so authorization belongs in
the service layer where it can be read and tested.

## 8. The seam between the catalogue and circulation

The catalogue (Phase 2) describes what the library owns. Circulation (Phase 3)
owns what is happening to it. The line between them is sharp and worth knowing.

`catalogue-service.ts` never creates a `loan` row and never computes a due date.
`circulation-service.ts` never edits a title, an author, a shelf or a donation.
The only calls that cross are one-directional: the catalogue asks circulation
`copyIsOnLoan()` before letting a librarian change a status or archive a copy,
so the answer is a sentence rather than a Postgres exception.

**As of Phase 3, circulation owns `AVAILABLE` ↔ `BORROWED` outright.** `BORROWED`
left `SELECTABLE_STATUSES`: a copy reads BORROWED because a loan says so and for
no other reason, and a deferred constraint trigger refuses to commit any other
arrangement (ADR-024). A librarian may still set `AVAILABLE`, `LOST` or
`DAMAGED` — those are facts about a physical object, not circulation events —
but not on a book that is currently out. The edit form for such a book renders a
read-only note instead of a status control, and the service refuses the change
independently.

**As of Phase 4, `renewal_request` is wired.** A child asks; a librarian decides;
approving calls `renewLockedLoan`, the same function the desk's own button
calls, in one transaction with the decision (ADR-030). There is exactly one
renewal in this application and both paths run it — a rule added to renewal
cannot be missed by the request path, because that path has no rules of its own.

`notification-service.ts` is the third circulation-adjacent service and the most
constrained: it reads loans and writes `loan_notification` and `email_event`,
and touches nothing else. It cannot change a due date, a status or a borrower,
which is what makes a mail server's bad morning unable to alter what the library
believes about its books.

**Two pure things live in `src/lib/catalogue.ts` rather than in either service:**
`donorAcknowledgement()` and `Page<T>`. Both are needed by both sides — a child
looking at one of their own borrowed books sees the same thank-you as on the
book's page — and putting them in the shared isomorphic module is what stops the
two services importing each other in a circle.

Reader-facing types (`ReaderBookCard`, `ReaderBookDetail`) are **projections,
not filtered renders**: they have no field for a database id, an audit trail, a
storage path, a condition, or anything about who has borrowed something. A
template cannot leak a field that never left the server. See `CATALOGUE.md` §14.

## 9. What is deliberately absent

- No payment, billing or subscription code of any kind.
- No analytics, tracking pixels, ad networks or third-party scripts.
- No Redis — throttling is DB-backed, which is right for tens of logins a week.
- No reservation workflow (the `RESERVED` status ships; no code path sets it).
- No fines, late fees or any punitive mechanism — and no wording that implies
  one. A unit test asserts the absence of *fine, fee, charge, penalty, pay* and
  *owe* from every circulation message.
- No stored overdue state of any kind (ADR-025).
- No circulation notifications. The architecture is ready; nothing is sent.
- No delete anywhere in the catalogue — books are archived, never removed.
- No donation counter, total, rank or score, at any layer. There is no column to
  hang a leaderboard on, which is the most reliable way not to have one.
- No custom cryptography: tokens are `crypto.randomBytes`, hashing is argon2id,
  cookie encryption is Auth.js.
