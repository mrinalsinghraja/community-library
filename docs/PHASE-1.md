# Phase 1 — Identity, registration, authentication and account lifecycle

**Completed:** 2026-08-17
**Scope:** people. Not books.

---

## 1. What exists now

A family can join the library, a librarian can approve them, a child can set
their own password and sign in, and staff can be managed — all of it audited,
permission-gated and tested.

### New routes

| Route | Who | Purpose |
|---|---|---|
| `/join` | public | the registration form |
| `/activate/[token]` | guardian + child | choose the first password |
| `/forgot` | public | ask for a reset link |
| `/reset/[token]` | guardian + child | choose a new password |
| `/account/password` | signed in | change your own |
| `/desk` | staff | the desk landing page |
| `/desk/registrations` | librarian | the approval queue |
| `/desk/members` | librarian | readers: pause, close, resend link |
| `/admin/staff` | Super Admin | add, suspend, close, change role |
| `/dev/mail` | development only | captured email inbox — 404 in production |

### New modules

`server/lib/tokens.ts` · `server/lib/email/` (types, providers, templates,
service) · `server/lib/storage.ts` · `server/page-guards.ts` ·
`server/services/{registration,password,account,staff}-service.ts` ·
`lib/consent.ts` · `lib/avatars.ts`

### Migration 2 — `phase1_identity_lifecycle`

Hand-written, because the `ConsentMethod` change is a **rename**: Prisma's
generated migration would have dropped and recreated the enum, destroying
consent records. `ALTER TYPE … RENAME VALUE` preserves them, and the existing
demo record came through as `WEB_FORM`.

Also: `password_changed_at`, `status_reason`, `status_changed_at`,
`status_changed_by_id` on `app_user`; `revoked_at`, `requested_ip_hash`,
`attempt_count` on `auth_token`; a partial index for live-token lookup.

## 2. What changed from Phase 0

| | Phase 0 | Phase 1 |
|---|---|---|
| Member password minimum | 6 characters | **8** (ADR-013) |
| Password checks | blocklist, library name | + the person's own name/username/card, split into words; + optional breach check |
| `ConsentMethod` | `GUARDIAN_ONLINE_FORM`, `LIBRARIAN_RECORDED_IN_PERSON` | `WEB_FORM`, `EMAIL_CONFIRMATION`, `ADMIN_VERIFIED`, `OTHER_VERIFIED_METHOD` (ADR-014) |
| Consent wording | duplicated in the seed | single source in `src/lib/consent.ts` |
| Session validity | status + expiry | + refuses sessions older than the current password |
| Password change | — | ends **every** session, including the current one (ADR-015) |
| Permissions | 30 | 32 (`member.deactivate`, `guardian.edit`) |
| `/join` | placeholder | the real form |

Nothing in the Phase 0 architecture was replaced.

## 3. Verified, not assumed

Executed against the running application, not reasoned about:

| Claim | How |
|---|---|
| A parent can register a child | filled and submitted `/join` in a browser |
| No account exists before approval | database check between the two steps |
| The librarian sees the queue | screenshot: name, age 10, flat, guardian, "Consent given" |
| Approval creates the account | `MJCL-R0002`, status `INVITED`, `password_hash` NULL |
| The guardian is emailed a link | `/dev/mail`, addressed to `asha.sharma@example.invalid` |
| The child activates and sets a password | followed the real link; status → `ACTIVE`, argon2id hash present |
| Consent survives approval | 2 records, versioned, 402- and 271-character snapshots, attached to member **and** guardian |
| The audit trail is complete | 6 rows from submission to activation, no token anywhere |
| The child can sign in with their card | HTTP sign-in as `MJCL-R0002` → `/account` renders their role and `book.view` |
| A child cannot reach staff pages | `/desk`, `/desk/registrations`, `/desk/members`, `/admin/staff` → 307 to `/account` |
| A librarian cannot reach staff admin | `/admin/staff` → 307; `/desk/registrations` → 200 |
| Suspension is immediate | suspended a signed-in child → next request 307 to sign-in, **0 session rows** |
| Reset mail goes to the guardian | `/forgot` with the child's card → `password_reset` to the guardian |
| Reset tokens are hashed | 64-char hash stored, IP hashed, audit records the request without the token |

## 4. Bugs found and fixed during this phase

1. **`"use server"` modules may export only async functions.** `account-actions.ts`
   exported a constant, which made *every* action in the file fail at module
   evaluation. `next build` compiled it happily; it appeared on the first real
   submit. Removed, and the other two action files audited.
2. **A child hitting a staff URL got a 500.** Access was correctly denied — the
   service threw — but the response was a crash page. Added `page-guards.ts`,
   which redirects politely while the service still throws.
3. **Password change could not keep the current session.** The new "session older
   than the password is invalid" rule made it impossible. Rather than weaken the
   rule, password change now ends every session and the user signs in again.
4. **Personal-detail matching was too literal.** `"Rosalind Chen"` did not block
   `rosalind99`, because it compared the whole string. Now splits into words.
5. **Test IP reuse hit the reset throttle**, starving later tests — the rate
   limiter working correctly against its own test suite. Each test now uses a
   distinct address, and the throttle got its own test.

## 5. Security review

Reviewed specifically for the classes named in the brief.

| Class | Finding |
|---|---|
| IDOR | Member endpoints take the id from the *session*, never the request. Probing another child returns `NOT_FOUND`, identical to a nonexistent id. Tested. |
| Privilege escalation | A librarian holds `member.suspend`; without a `kind` check they could have suspended a Super Admin through the member endpoint. `loadMember` refuses STAFF users. **Tested explicitly.** |
| Self-escalation | Nobody can change their own role, or suspend/deactivate themselves. The last active Super Admin cannot be removed. Tested. |
| Account enumeration | One message for every login failure; identical timing via `fakeVerifyDelay`; silent duplicate registrations; silent reset throttling; one message for every bad link. Tested. |
| Token reuse | Single use enforced by `UPDATE … WHERE consumed_at IS NULL`, not a read-then-write check. Tested. |
| Token leakage | Raw token exists only in the email. Not in logs, audit metadata, or the delivery log. Tested. Token pages set `referrer: no-referrer`. |
| Session fixation | Auth.js issues a fresh cookie on sign-in; the session row is created at that moment; no pre-authentication session exists to fixate. |
| CSRF | Auth.js CSRF token; SameSite=Lax; Next.js server-action origin checks. |
| XSS | React escaping; email templates escape interpolated names — tested with a script-tag name. |
| Authorization bypass | Every service entry point calls `requirePermission` first. Page guards are cosmetic only and documented as such. |
| Upload security | Magic-byte sniffing, executable rejection, size caps, random keys. Photo upload is not yet exposed in the form. |

### Still open

- No penetration test.
- Consent wording and verification strength not legally reviewed (`CONSENT.md`).
- `x-forwarded-for` is trusted for throttling. Behind Vercel the platform sets
  it; a spoofed value costs the attacker their own bucket.
- No browser end-to-end suite; Phase 1 flows were verified manually.

## 6. Tests

**188 passing** — 84 unit, 104 against real PostgreSQL. Phase 0 had 110.

| Suite | Count | Covers |
|---|---|---|
| `registration.test.ts` | 16 | submission, age at both ends and at approval, consent capture, duplicates, approval, rejection, queue authorization |
| `activation-and-reset.test.ts` | 24 | valid/expired/reused/revoked tokens, reissue revoking the old link, policy at activation, reset to guardian, silent unknown identifiers, throttling, password change |
| `authorization.test.ts` | 20 | member→staff, librarian→admin, the cross-service escalation, self-escalation, last-admin protection, contact stripping, no hash in any payload |
| `email-templates.test.ts` | 14 | no passwords, escaping, internal reasons withheld, correct addressee |
| `password.test.ts` | 24 | the 8-character policy, personal details, library names, staff bar, hashing |
| Phase 0 suites | 90 | constraints, codes, sessions, dates, uploads, audit redaction |

## 7. Not built

Book catalogue, search, borrowing, returns, renewals, donor page, reports —
all Phase 2 and later. Junior Librarian remains seeded and unassignable. Photo
upload remains behind the consent review. Guardian login does not exist.

## 8. Known limitations

1. `next-auth` is still a beta dependency.
2. No browser end-to-end suite.
3. No automated accessibility assertions.
4. Consent wording is not legally reviewed — **the top blocker**.
5. Email is implemented but no production provider is configured.
6. No archival/redaction step; retention periods need a community decision.
7. Photo upload validated and tested but not exposed in the form.
8. Still not deployed: no Neon project, no Vercel project.

## 9. Next step

Phase 2 — the book catalogue: titles and copies, categories, donor attribution
with consent, search, and the "Thank You, Book Donors" page. Circulation
(issue, return, renew) follows in Phase 3.

Do not start before this phase has been inspected.
