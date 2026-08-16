# Security

This application holds personal information about children. That fact drives
every decision below.

---

## 1. The legal position — read this before launch

India's **Digital Personal Data Protection Act, 2023** governs processing of a
child's personal data. It requires **verifiable parental consent** and prohibits
behavioural tracking and targeted advertising directed at children.

**What this codebase does:** captures a structured, versioned consent record
with a verbatim snapshot of the wording shown, records who gave it and when,
supports withdrawal, collects the minimum data needed to run a library, and
carries no analytics, no tracking pixels, no ad networks and no third-party
scripts on any page.

**What this codebase does NOT do, and cannot claim:**

> **The consent wording in `prisma/seed/library-config.ts` has not been reviewed
> by a lawyer, and the strength of parental verification implemented here (a
> guardian ticking a box on a web form) may not satisfy "verifiable parental
> consent" as the applicable rules define it.**
>
> **Both the wording and the verification mechanism must be reviewed against the
> current Indian requirements before this is used with real children's data.**

The data model is deliberately shaped so that stronger verification can be added
later without rewriting registration: `ConsentMethod` is an enum, and adding
(for example) an in-person librarian confirmation or an out-of-band check is a
new value plus a new code path, not a schema migration.

No government identity documents are collected, and none should be added without
a specific, approved reason.

## 2. Data minimisation

Collected about a child: name, date of birth, apartment, optional photo or
avatar. Nothing else.

Collected about a guardian: name, phone, email.

Deliberately **not** collected: school, academic information, street address
beyond the flat identifier, demographics, social accounts, location, behavioural
data, advertising identifiers.

## 3. Children's privacy inside the product

- A member's session, not the request, decides whose data is loaded. A child
  asking for another child's id gets `NotFound` — never `NotAuthorized`, because
  that would confirm the id is real.
- There is no member directory in any member-facing surface.
- No public page connects a book to a borrower.
- Guardian phone and email sit behind `member.view_contact`, which the seeded
  Junior Librarian role can never hold (asserted by test).
- Child photographs are stored **private**, served only through an authorised
  route, and a database CHECK forbids a private object from carrying a public
  URL. Avatars exist so no family feels obliged to upload a photo.

## 4. Authentication controls

| Control | Implementation |
|---|---|
| Password hashing | argon2id, m=19456 KiB, t=2, p=1 |
| Plaintext passwords | Never stored, never logged, never emailed, visible to no role |
| Session transport | Opaque random handle in an httpOnly, SameSite=Lax cookie; `__Host-` prefixed in production |
| Session storage | Server-side rows; only the SHA-256 of the handle is stored |
| Revocation | Suspension deletes every session for the user; effective on the next request |
| Session lifetime | Staff 8 h idle / 12 h absolute · Members 24 h idle / 7 d absolute |
| Throttling | 5 failures per identifier → 15-minute lock; 20 failures per IP per hour |
| Enumeration | One generic failure message for unknown user, wrong password, suspended account and lockout alike |
| Timing | A login against a non-existent account burns comparable CPU to a real verification |
| Tokens | 32 random bytes, stored as SHA-256, single use, time limited |

Password policy differs by audience by design — see ADR-006.

## 5. Application controls

| Area | Control |
|---|---|
| Authorization | `requirePermission()` at every service entry point; deny by default |
| Edge middleware | Cookie-presence gate only. It is **not** authorization — the edge has no database access and cannot distinguish a valid cookie from a forged one |
| Input | Zod at every boundary, including server action FormData |
| SQL injection | Parameterised Prisma queries; the few raw statements are parameterised |
| XSS | React escaping; no `dangerouslySetInnerHTML` anywhere |
| CSRF | Auth.js CSRF token, SameSite=Lax cookies, Next.js server action origin checks |
| CSP | Per-request nonce with `strict-dynamic`; no `unsafe-inline` for scripts; `connect-src 'self'` |
| Headers | HSTS (2 years, preload), `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, restrictive `Permissions-Policy`, COOP |
| Uploads | Magic-byte sniffing, size caps, executable-signature rejection, random storage keys — the user's filename never enters a path |
| Secrets | Environment variables only; `.env` gitignored; gitleaks in CI |
| Audit | Every mutation logged in the same transaction; a recursive redactor strips anything resembling a credential |
| Dependencies | Pinned; `npm ci` in CI |

### Verified in Phase 0

- Security headers present on responses (checked against the running server).
- CSP carries a per-request nonce.
- Unauthenticated `/account` → 307 to `/login`.
- Suspended member with a valid cookie → signed out on the next request, zero
  session rows remaining.
- `/api/cron/daily` returns 404 without the correct bearer secret.
- Uploads: ELF, Mach-O, shell script and zip signatures rejected even when named
  `.jpg`; declared Content-Type ignored in favour of actual bytes.
- Audit redaction covers nested objects and varied key casing.

## 6. Known gaps at the end of Phase 0

These are honest limitations, not oversights:

1. **No penetration test** has been performed.
2. **Consent wording is not legally reviewed** (§1).
3. **Rate limiting is per-instance-agnostic but database-backed**, so it is
   correct across serverless instances — but it counts rows, and a very large
   burst would cost queries. Fine at this scale; revisit if the library grows.
4. **`x-forwarded-for` is trusted** for throttling. Behind Vercel this is set by
   the platform. A spoofed value costs the attacker their own bucket, not
   someone else's, but it is not a strong identity.
5. **SVG is accepted for branding uploads only** (a Super Admin action). SVG can
   carry script and must always be served from a restrictive-CSP path, never
   inlined. It is refused for anything a parent can upload.
6. **No account-deletion flow yet.** The schema supports archival; the workflow
   is later-phase work.
7. **Backups** — Neon's free tier gives only a 6-hour point-in-time restore
   window, so a scheduled logical backup is required before production use.

## 7. Reporting a problem

Security issues should go to the library's Super Admin directly, not into a
public issue tracker.
