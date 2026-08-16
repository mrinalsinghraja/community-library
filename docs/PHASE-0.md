# Phase 0 — Foundation

**Completed:** 2026-08-17
**Scope:** foundation only. Not the library application.

---

## What exists now

### Application
Next.js 16.3.1 (App Router) · React 19.2 · TypeScript strict · Tailwind v4.
Six routes, all rendering from configuration:

| Route | Purpose |
|---|---|
| `/` | Branded home page — name, welcome, age range, loan rules, all from the database |
| `/rules` | "How it works", every number read from `library_settings` |
| `/join` | Public placeholder stating the library's promises; the form is Phase 2 |
| `/login` | Working sign-in, one field accepting card code, username or staff email |
| `/account` | Signed-in landing showing the actor's roles and resolved permissions |
| `/api/health`, `/api/auth/*`, `/api/cron/daily` | Health, Auth.js, daily housekeeping |

### Database
27 tables, one migration, applied and verified against PostgreSQL 17.
31 CHECK constraints, 6 hand-written indexes including the partial unique index
that makes a double issue impossible.

### Authentication and access
Auth.js v5 Credentials, argon2id hashing, server-side session records with
opaque cookie handles, DB-backed throttling, database-driven RBAC with five
seeded roles.

### Security
CSP with per-request nonce, HSTS, `nosniff`, `frame-ancestors 'none'`,
restrictive `Permissions-Policy`, upload validation by magic bytes, audit
logging with credential redaction, gitleaks in CI.

### Design system
"The Reading Corner" — measured contrast, 18px base type, 56–68px touch targets,
two motifs, friendly non-punitive voice. Documented in `DESIGN_SYSTEM.md`.

### Tests
110 passing: 66 unit, 44 against real PostgreSQL.

---

## Verified, not assumed

Each of these was executed against the running application, not reasoned about:

| Claim | How it was checked |
|---|---|
| Migration applies cleanly | `prisma migrate deploy` on a fresh database; 28 tables present |
| No schema drift | `prisma migrate diff` returns empty; also gated in CI |
| Constraints hold | 23 constraint tests, each asserting rejection *and* that valid data passes |
| Double issue is impossible | Two concurrent inserts: exactly one succeeds |
| Codes are race-free | 40 parallel allocations → 40 distinct consecutive values |
| Seed works | Ran clean: 30 permissions, 5 roles, 14 categories, 6 titles, 7 copies |
| Sign-in works end to end | HTTP: CSRF → credentials POST → session cookie → `/account` renders the reader's name, role and permission |
| Suspension is immediate | Suspended a live member; next request with the same cookie → 307 to `/login`, zero session rows left |
| Unauthenticated routes redirect | `/account` → 307 `/login?next=%2Faccount` |
| Cron is protected | 404 without the bearer secret; runs and reports with it |
| Security headers ship | `curl -I` on the running server |
| Health endpoint | Returns `{"status":"ok"}` |
| Responsive | 375px viewport: no horizontal overflow, header and hero legible |
| Production build | `npm run build` succeeds; all config-reading routes are dynamic |

## Bugs found and fixed during this phase

1. **Session idle-expiry could exceed absolute expiry**, violating a CHECK
   constraint and turning an ordinary page load into a 500 late in a session's
   life. Clamped.
2. **`prisma migrate dev` silently dropped a raw trigram index.** Rebuilt as an
   expression index, which Prisma's reconciliation leaves alone; CI now fails on
   drift.
3. **Two different member-code formats** — `MJCL-R-0042` in the login hint vs
   `MJCL-R0001` from the seed. Separator rule made explicit and tested.
4. **Lint caught three real violations**: a route importing the database
   directly, a hard-coded community name in a login hint, and community-specific
   entries in the password blocklist. All three now read from configuration.
5. **`/join` and `/rules` were prerendered**, which would have frozen library
   configuration at build time. Forced dynamic.

## Deliberate deviations from the blueprint

| Blueprint said | Built | Why |
|---|---|---|
| Next.js 15 | Next.js 16.3.1 | Current patched line; Vercel refuses CVE-affected versions (ADR-004) |
| Catalogue public by default | `MEMBER_ONLY` by default | Owner's instruction (ADR-007) |
| Auth.js database sessions | Opaque handle + server-side session table | Credentials provider cannot use native DB sessions — verified in `@auth/core` source (ADR-009) |
| Consent as a field | `consent_record` ledger | Phase 0 instruction; also better evidence (ADR-011) |
| Neon PITR as backup | Scheduled `pg_dump` required | Free-tier PITR verified as 6 hours only |

## Not built — and deliberately so

Registration form and approval queue · book catalogue UI · issue/return ·
donor page · reports · email delivery · reservations · reading badges ·
Junior Librarian activation (role seeded, not assignable).

The `RESERVED` copy status and the `renewal_request` table ship in the schema so
those workflows need no migration later. No Version 1 code path uses them.

## Known limitations

1. **`next-auth` is a beta dependency** (`5.0.0-beta.32`). It is the standard
   App Router path, but it is beta.
2. **No browser end-to-end suite.** Phase 0 flows were verified manually against
   the running app; Playwright earns its place once there are forms to drive.
3. **No automated accessibility assertions.** Contrast was measured numerically;
   axe should run in CI once there are forms and tables to scan.
4. **Consent wording is not legally reviewed.** See `SECURITY.md` §1. This is
   the single most important open item before real children's data is entered.
5. **Email is not implemented.** Variables are declared and validated; delivery
   is Phase 5. Activation therefore cannot be completed by email yet.
6. **No account-deletion workflow.** The schema supports archival; the flow is
   later work, and retention periods need community and legal input.
7. **Not deployed.** No GitHub repository, Neon project or Vercel project has
   been created — all three need the owner's accounts.

## Next step

Phase 1 — Identity: activation and password-reset flows, the `/setup` bootstrap
route, staff management, the admin shell, and the first real end-to-end tests
of the registration-to-activation path.

Do not start it before this foundation has been inspected.
