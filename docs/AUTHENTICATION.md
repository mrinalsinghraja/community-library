# Authentication

Sign-in, sessions, tokens and passwords.

---

## 1. Sessions

Unchanged from Phase 0, and deliberately so — ADR-009 explains why the cookie
carries only an opaque handle rather than a self-contained token.

One addition in Phase 1: `resolveSession` now also refuses any session created
before `app_user.password_changed_at`.

```
cookie ──► opaque handle ──► session row ──► checks, every request:
                                              • row exists, not revoked
                                              • absolute expiry not passed
                                              • idle expiry not passed
                                              • user.status === ACTIVE
                                              • session older than the current
                                                password?  → refuse
```

That last check makes "changing the password signs everything out" true by
construction rather than by remembering to call a function.

| Kind | Idle | Absolute |
|---|---|---|
| Staff | 8 h | 12 h |
| Member | 24 h | 7 d |
| Guardian | 1 h | 12 h |

## 2. Password policy

| Audience | Minimum | Rules |
|---|---|---|
| Member | **8 characters** | no complexity requirements |
| Staff | 12 characters | zxcvbn score ≥ 3 |

Both additionally refuse: a common-password blocklist, the library's and
community's own names (from configuration), and the person's own name, username
or card code — split into words, so "Rosalind Chen" blocks `rosalind99`.

**Phase 1 raised the member minimum from 6 to 8.** Reasoning in ADR-013. The
short version: lowercase-only at 6 characters is about 3×10⁸ candidates, which
argon2id makes expensive rather than impossible; 8 is a thousandfold better and
costs a child nothing, because we ask for *length*, never for symbols.

The form's hint teaches the useful habit — join two words together — rather than
listing rules. `bluecatjumps` passes; `Bl0e!` does not.

### Breached-password checking

Optional, off by default, enabled with `PASSWORD_BREACH_CHECK=true`. Uses Have I
Been Pwned's k-anonymity range API: only the first five characters of the SHA-1
hash leave the server. **Fails open** with a 2.5-second timeout — a family must
be able to finish setting up an account when a third-party service is having a
bad day.

## 3. Tokens

Activation and password reset share one implementation (`server/lib/tokens.ts`).

| | Activation | Password reset |
|---|---|---|
| Lifetime | 7 days | 2 hours |
| Entropy | 32 random bytes (256 bits) | same |
| Stored as | SHA-256 hash | same |
| Single use | yes, atomically | yes, atomically |

**Single use is enforced by the database, not by a check.** `consumeToken` runs
`UPDATE … WHERE id = ? AND consumed_at IS NULL …`; a second submit matches zero
rows and is told the link is spent. A read-then-write check would race here.

**Issuing a new token revokes any live one of the same type.** The email already
sitting in a guardian's inbox stops working the moment a fresh link is sent.

**Revoked, consumed and expired are three different states**, because "the link
was cancelled" and "the link was used twice" are very different events to find
in an audit log later.

The raw token exists in exactly one place: the link inside the email. It is
never logged, never audited, never stored. A test asserts the audit log for a
newly-approved member contains neither the token nor the word "token".

## 4. What failure looks like

Every one of these produces the same message and the same timing:

- no such identifier
- wrong password
- account suspended, deactivated or not yet activated
- identifier locked out

> That didn't work. Check the spelling and try again.

A login against a non-existent account still burns comparable CPU
(`fakeVerifyDelay`), so response timing does not reveal which member codes are
real.

Failed links are equally uniform:

> That link has expired or has already been used. Ask your librarian for a new one.

Expired, spent, revoked and never-existed are indistinguishable from outside.

## 5. Rate limits

All database-backed; no Redis.

| Action | Limit |
|---|---|
| Failed logins per identifier | 5 → 15-minute lock |
| Failed logins per IP | 20 per hour |
| Registration submissions per IP | 5 per hour |
| Password-reset requests per IP | 5 per hour |
| Token presentations per IP | 20 per hour |

Deliberately not aggressive: a child mistyping their secret word three times is
normal, and a parent tapping an emailed link twice is normal. The reset limit is
low because each one sends mail to a family.

**Throttling is silent on the reset path.** Being told "slow down" would confirm
there was something worth slowing down for.

## 6. Who can do what to a password

| | See it | Set it | Trigger a reset link |
|---|:--:|:--:|:--:|
| The account holder | — | ✅ (with the current one) | ✅ |
| Librarian | ❌ | ❌ | ✅ (to the guardian) |
| Super Admin | ❌ | ❌ | ✅ |
| Database administrator | argon2id hash only | — | — |

There is no permission for viewing a password because there is no code path
that reads a hash outside the authentication service — asserted by a test over
`listMembers()` and `listStaff()` output.

## 7. Changing your own password

Requires the current one — a borrowed unlocked device must not become a
permanent account takeover.

**Every session ends, including the one making the change.** Keeping the current
session alive would require rotating its cookie, which only the auth layer can
do; rather than pretend, the person is signed out and asked to sign in with the
new password. The guardian is emailed that it happened.
