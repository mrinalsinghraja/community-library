# Account lifecycle

---

## 1. States

```
                    ┌──────────┐
   approval  ──────►│ INVITED  │  account exists, no password, link sent
                    └────┬─────┘
                         │ activation link + password chosen
                         ▼
                    ┌──────────┐
        ┌──────────►│  ACTIVE  │◄──────────┐
        │           └────┬─────┘           │
        │                │ suspend          │ reactivate
        │                ▼                  │
        │           ┌───────────┐           │
        └───────────┤ SUSPENDED ├───────────┘
                    └────┬──────┘
                         │ deactivate (family moved away)
                         ▼
                   ┌──────────────┐
                   │ DEACTIVATED  │
                   └──────┬───────┘
                          │ retention policy — NOT IMPLEMENTED (§5)
                          ▼
                    ┌──────────┐
                    │ ARCHIVED │
                    └──────────┘
```

Reactivating a member who never chose a password returns them to `INVITED`, not
`ACTIVE` — otherwise reactivation would hand out an account with no password.

## 2. What each transition does

| Transition | Permission | Effects |
|---|---|---|
| Approve → INVITED | `registration.review` | creates user, card, guardian link, activation token; audits |
| Activate → ACTIVE | (the token) | sets password, clears `must_set_password`, audits |
| Suspend | `member.suspend` | requires an internal reason · **deletes every session** · emails the guardian a generic note · audits |
| Reactivate | `member.suspend` | clears the reason · restores ACTIVE or INVITED · emails the guardian · audits |
| Deactivate | `member.deactivate` | requires a reason · revokes live tokens · deletes sessions · audits |
| Reissue activation | `member.reset_password` | revokes the old link, mints and emails a new one |

Staff accounts use the parallel `staff-service`, gated on `user.manage_staff`.

## 3. Suspension is immediate, not eventual

A suspended account must not still be browsing. Two independent mechanisms:

1. The service deletes every session row for that user in the same operation.
2. `resolveSession` refuses any session whose user is not `ACTIVE`, and deletes
   the rows it finds.

Either alone would be sufficient; both exist because this is the property the
whole session design was chosen for. Verified in tests **and** live against the
running application: suspend a signed-in reader, and their very next request
redirects to sign-in with zero session rows remaining.

## 4. Internal reasons stay internal

Suspending or deactivating requires a note of at least three characters. It is
stored on `app_user.status_reason`, written to the audit log, and shown only to
staff.

The family gets:

> Aarav's account at Mana Jardin Children's Library has been paused for the
> moment… Please have a word with the librarian and we will get it sorted.

No reason, no accusation. Whatever happened is better said in person, and the
child may well be reading over a shoulder. A test asserts the suspension email
contains no reason-like language.

## 5. Deactivation does not delete anything

`DEACTIVATED` closes an account. It does **not** remove the person's history:

- `loan.member_user_id` uses `onDelete: Restrict`, so closing an account cannot
  silently erase the library's own circulation records.
- `audit_log.actor_label` is denormalised, so the log stays readable after an
  account is gone.
- Consent records survive — the evidence that consent was given matters as much
  after an account closes as before.

### The archival step is built, and switched off

`ARCHIVED` means: personal fields on `app_user` and `member_profile` redacted,
loan history retained and attributed to the reader's own member code. The
nightly pass in `src/server/lib/retention.ts` does it. See ADR-061.

**No retention period has been invented.** All three columns are nullable and
all three are unset, and unset means keep indefinitely — which is exactly what
this library does today. The pass returns early, the privacy notice says plainly
that no schedule is in force, and `DEACTIVATED` remains the terminal state in
practice.

The four questions are still the four questions, and they are now a form rather
than a code change:

- How long is a departed member's name kept? → `archive_closed_after_months`
- How long is a child's photograph kept? → `remove_photo_after_closed_days`
- How long are guardian contact details kept after the last child is erased? →
  `remove_guardian_after_months`
- What happens on an explicit deletion request? → still a conversation with a
  librarian; nothing automates it, and the privacy notice says so.

They need a community decision and, given the DPDP Act, a legal one. What has
changed is that answering them is now typing three numbers into
`/admin/settings`, and that the answer is written on `/privacy` in the same
words the software runs on.

## 6. Guardian contact changes

Staff-only, always — `guardian.edit`, held by Librarian and Super Admin.

The guardian's email is the *recovery channel* for a child's account: anyone who
can change it can take the account over on the next reset. So:

- A child can never change it. Verified by test.
- There is no unauthenticated "update your details" link, by design.
- Changing the email **revokes every live activation and reset token** for every
  child linked to that guardian, so a link already sent to the old address
  cannot be completed afterwards.
- The audit log records *that* the recovery address changed, never the addresses
  themselves.

**Recommendation, not implemented:** for a library this size, a librarian
changing a guardian's email after speaking to them in person is proportionate.
If the library grows, or if staff turnover increases, the next step is to
require a second staff member's confirmation — the audit trail already captures
who made the change, which is what such a policy would build on.

## 7. Protections against locking the library out

Staff management refuses to:

- suspend, deactivate or demote **yourself**;
- remove the **last active Super Admin**, by suspension, deactivation or role
  change.

Both are easy accidents with expensive consequences — a community library with
no working administrator is recoverable only by someone with database access.
Both are tested.
