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

> **The consent wording in `src/lib/consent.ts` has not been reviewed
> by a lawyer, and the strength of parental verification a deployment configures
> may not satisfy "verifiable parental consent" as the applicable rules define
> it.**
>
> **Both the wording and the verification mechanism must be reviewed against the
> current Indian requirements before this is used with real children's data.**

**Consent and guardian verification are separate concerns** (ADR-017). Consent
records what a family agreed to; `guardian_verification` records what evidence
exists that they are who they say. A ticked box gives an excellent first and
essentially no second, and since Phase 1.1 the software says so rather than
implying otherwise — including a standing banner on the librarian's queue while
the configured requirement is that weak.

How strong a verification a deployment demands is a **setting**
(`library_settings.required_guardian_verification`), gated at both approval and
activation. It is never a constant in code, because that would be this software
answering a legal question it must not answer.

**Where the Indian rules stand, 17 August 2026:** the DPDP Act 2023 is enacted;
the DPDP Rules 2025 were notified in November 2025; **Rule 10 on children's data
commences 13 May 2027.** Enacted, notified, and not yet in force are three
different things — see `GUARDIAN_VERIFICATION.md` §6. This is not a reason to
delay the wording review, which is needed the moment a real child's data is
entered.

No government identity documents, Aadhaar numbers or KYC of any kind are
collected, and none should be added without a specific, approved reason. Neither
consent nor verification has a field to put one in, deliberately.

Full detail: `CONSENT.md` and `GUARDIAN_VERIFICATION.md`.

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
  URL. Avatars exist so no family feels obliged to upload a photo, and a photo is
  never the default. Full architecture: `MEDIA.md`.
- A photograph is readable by the child themselves and by staff who need it, and
  by nobody else. Every refusal is `404`, never `403` — a 403 would confirm the
  id is real. Verified live: another child's id and an id that never existed
  return identical responses.
- A private photograph never outlives the row pointing at it, and an abandoned
  upload never becomes unreachable bytes (ADR-019).
- **The one action a child can take writes one row and moves nothing.** A
  renewal request is keyed by the book code printed on the book and resolved
  against the session's own loans (ADR-031) — there is no loan id, member id or
  library id in any reader-facing form, so there is nothing to tamper with. Every
  miss returns the same sentence, whether the code is fictional, somebody else's,
  or already returned.
- A child never sees another child's request, another child's decision, or a
  librarian's note about their own. The note is the library's record; the child's
  screen shows one kind sentence.

### Reminders

- Mail goes to the **guardian**, never to the child — children in this library
  have no email address.
- One child and one book per message. No other family appears in any message.
- **No link.** Nothing to click and nothing to log into: a reminder carrying a
  login link is one more link for somebody to imitate.
- The reminder claim row stores **no address**. Who was written to lives in
  `email_event`, once, so a family leaving means one place to clear.
- Writing to guardians is off until a library turns it on
  (`overdue_reminders_enabled`, default false).

## 4. Authentication controls

| Control | Implementation |
|---|---|
| Password hashing | argon2id, m=19456 KiB, t=2, p=1 |
| Password policy | members 8 chars minimum, staff 12 + zxcvbn ≥ 3; blocklist, library name, and the person's own name/username/card all refused (ADR-013) |
| Breached passwords | optional, opt-in, k-anonymity, fails open (`PASSWORD_BREACH_CHECK`) |
| Activation & reset tokens | 32 random bytes, SHA-256 stored, single use enforced by `UPDATE … WHERE consumed_at IS NULL`, time limited, superseded on reissue |
| Password change | ends **every** session, including the current one (ADR-015) |
| Stale sessions | a session created before `password_changed_at` is refused, independently of explicit revocation |
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
| Edge middleware | Cookie-presence gate only. It is **not** authorization — the edge has no database access and cannot distinguish a valid cookie from a forged one, nor a live session from an expired one. Anything that needs the second answer belongs on the page |
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

### Verified in Phase 3

- **The same wrong-guard trap, one phase later.** `loan.view` is held by every
  reader — it is what lets a child see their own books — so a desk screen
  guarded by it would hand any nine-year-old the whole library's loan list with
  every borrower's name on it. The desk queries require
  `["loan.issue", "loan.return", "loan.renew"]` instead, and a test asserts a
  member cannot reach `listLoansForStaff`, `countDeskLoans`, `searchReaders` or
  `searchCopies`. The rule now written down twice: **a permission that readers
  hold can never guard a staff surface.** ADR-026.
- **No reader-facing surface can name a borrower.** There is no function in the
  application that answers "who has this book?" to a child. `copyIsOnLoan()`
  returns a boolean and nothing else, and `listOwnLoans()` takes **no member
  id** — it reads the session, so there is no ownership check to forget and no
  id in a URL to increment. A test serialises a reader's whole response and
  asserts another child's name and id are absent from it.
- **Apartment is not a search key for children.** The desk finds a child by name
  or card number only. A desk that offered "show me everyone in B-402" would be
  a directory of who lives where with whom, and the trigram index that makes
  name search fast was deliberately not built over apartment.
- **A refusal to lend says nothing about why an account is paused.** The message
  is "This library account is currently unavailable for borrowing." A test
  asserts the internal `status_reason` a librarian wrote does not appear in the
  error, and that the message itself contains none of *suspend, deactivat,
  archiv, banned* or *reason*.
- **Client-side disabling is not the control.** Verified in the browser: forcing
  a disabled Issue button past its `disabled` attribute is still refused by the
  server, leaves the loan count unchanged, and writes a `loan.issue.refused`
  audit row. The same for a second renewal past the maximum.
- **Donor acknowledgement stays independent of circulation.** No view renders
  "donated by X and borrowed by Y" — the donors page has no borrower column to
  add one to, and no donor-facing shape carries a borrower at all.

### Verified in Phase 2

- **A permission that was the wrong guard.** Every reader holds `book.view` —
  that is what lets a child browse — so guarding the librarian's screens with it
  would have shown any nine-year-old the staff book list, donor names and
  condition notes included. The desk now requires
  `book.create`/`book.edit`/`book.archive`, at the service and at the page, and
  a test asserts a member is refused. Found while writing the authorization
  tests, not by reading the code.
- A member calling the catalogue services directly cannot create, edit, archive,
  change a status or change donor information: `NOT_AUTHORIZED` from the service,
  with the record unchanged afterwards.
- A child loading `/admin/books` or `/admin/books/new` is redirected to their own
  account.
- **A book cover cannot be a child's photograph.** `claimUnclaimedBookCover` is
  scoped by purpose, so a book form carrying a child photo's media id is refused
  and no book is created. Covers keep a *different* authorization rule from child
  photographs, written as its own branch so a change meant for one cannot loosen
  the other.
- Covers are stored `PRIVATE` with no public URL, because the catalogue is
  `MEMBER_ONLY` and a CDN link would bypass the front door. Verified live: `200`
  for a signed-in member with `no-store` and `default-src 'none'; sandbox`
  intact, `404` signed out — byte-identical to an unknown id.
- A cover uploaded from the browser reached storage EXIF-stripped (70 bytes,
  `IHDR`/`IDAT`/`IEND` only), under a generated key, outside `public/`.
- Donor names are **not searchable**: `?q=Mrinal` returns nothing, so the
  catalogue cannot be enumerated by who lives where.
- A wildcard in a search term (`%`) matches literally rather than the whole
  catalogue.
- Sort order comes from a fixed map, never from the query string — `Prisma.raw`
  escapes nothing.
- A book copy id belonging to another library resolves to `NOT_FOUND`, never
  "forbidden".
- Nothing reader-facing carries a database id, a storage path, a condition, an
  audit field, or any child's name — verified across the browse grid, a detail
  page and `/donors`.
- **A lock-out fixed on the way through.** The proxy bounced any request carrying
  a session cookie away from `/login`, but the edge can only see that a cookie
  *exists*. A session that had gone idle therefore bounced `/account` → `/login`
  → `/` for ever, and the reader could not sign in again. The check now lives on
  the login page, which resolves the real session. Availability, not
  confidentiality — nothing else about authentication changed.

### Verified in Phase 1.1

- Registration with and without a photograph, walked in a browser end to end.
- Photo served only through `/api/media/[id]`: `200` for the librarian, `404`
  signed out, `404` for a different child — byte-identical to an id that never
  existed.
- **A real header bug found by probing rather than reading.** `src/proxy.ts` was
  overwriting the media route's `default-src 'none'; sandbox` with the *page*
  CSP, so children's photographs were being served under the application's script
  policy. `api/media` is now excluded from the proxy matcher; re-verified live.
- Replace: profile re-pointed, old row **and** old bytes gone, exactly one file
  on disk, both ids in the audit row.
- Remove: profile cleared, avatar restored, zero rows, zero bytes, audited with
  the actor and the reason.
- Production gate closed and reopened live: with `STAFF_VERIFIED` required, the
  queue showed `GUARDIAN VERIFICATION: Missing` and replaced Approve with
  "Confirm the guardian"; after a named librarian recorded a confirmation it read
  `Staff confirmed` and Approve returned.
- An account stripped of its verification records cannot be activated even with a
  valid activation link.
- The database refuses to store a `SELF_DECLARED` method at `IDENTITY_PROVIDER`
  strength.

### Verified in Phase 1

- Full journey walked in a browser: `/join` → approval → emailed link →
  activation → child sign-in.
- A child hitting `/desk`, `/desk/registrations`, `/desk/members` or
  `/admin/staff` → 307 to `/account`.
- A librarian hitting `/admin/staff` → 307; `/desk/registrations` → 200.
- **Cross-service privilege escalation blocked**: a librarian holds
  `member.suspend`, and without a `kind` check could have suspended a Super
  Admin through the member endpoint. `loadMember` refuses STAFF users; tested.
- Suspension of a signed-in child → next request redirected, **0 session rows**.
- Reset mail goes to the guardian, never the child; token stored hashed; the
  audit log records the request without the token.
- Consent survives approval with versioned, verbatim wording snapshots.

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

## 6. Known gaps

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
8. **No archival/redaction step.** `DEACTIVATED` is the terminal state in
   practice. Retention periods need a community and legal decision, and none has
   been invented — see `ACCOUNT_LIFECYCLE.md` §5.
9. **Guardian email changes are staff-only** with no second-approver
   requirement. Proportionate at this size; the audit trail is in place if the
   library later wants one — see `ACCOUNT_LIFECYCLE.md` §6.
10. **`VERIFIED_IDENTITY_PROVIDER` is representable but not implemented.**
   Configuring it would make approval impossible — a deliberate fail-closed, but
   not a working option.
11. **Email confirmation proves control of an inbox, not parenthood**, and
   opening the emailed link is enough to complete it, so a prefetching mail
   client could spend the token. Reasoning in `GUARDIAN_VERIFICATION.md` §7.
12. **Verification never expires.** The model carries `expires_at` and the read
   path honours it, but nothing sets it: the retention and reverification policy
   is still an open question for the owner.

## 7. Reporting a problem

Security issues should go to the library's Super Admin directly, not into a
public issue tracker.
