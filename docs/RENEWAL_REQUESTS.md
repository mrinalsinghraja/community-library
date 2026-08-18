# Renewal requests

A child asks to keep a book. A librarian decides.

Phase 4. The table has existed since migration 1; this is the phase that wired
it.

---

## 1. Why it is a request and not a renewal

Version 1 decided that a physical book changes hands at the desk, so the desk
records it (BLUEPRINT §25.4). Children do not issue, return or renew.

But "you cannot renew" and "you cannot ask" are different rules, and only the
first one was ever intended. A nine-year-old halfway through a book on a
Wednesday has no way to reach the library until Saturday, and the honest thing
for the software to do is carry the question.

So a request is **the smallest possible write**: a row saying somebody asked.

> **Until a librarian answers, nothing about the loan has changed.** Same due
> date, same renewal count, same status, no new loan event. The child's card
> goes on showing the date the library actually holds.

This is asserted by a test, because it is the whole reason the feature is shaped
this way.

---

## 2. The lifecycle

```
                    ┌──────────► APPROVED   (and the loan is renewed, now)
                    │
   (child asks) ──► PENDING ───► DECLINED   (with a note the librarian wrote)
                    │
                    └──────────► CANCELLED  (the child changed their mind)
```

Four states, from the enum that shipped in migration 1. `DECLINED` is the
enum's word; the screens say "Not this time".

**The word stays `DECLINED`** — decided by the owner on 18 August 2026
(ADR-032), no migration. The internal state and the child's sentence are
deliberately different things: the database records what happened, and the screen
says it kindly.

A decided request is **final**. A child who still wants the book asks again,
which is a new row — because "the librarian said no on Tuesday" is part of what
happened and must not be overwritten. Both asks survive; a test says so.

**At most one PENDING request per loan**, enforced by a partial unique index:

```sql
CREATE UNIQUE INDEX renewal_request_one_pending_per_loan
    ON renewal_request (loan_id)
 WHERE status = 'PENDING';
```

Partial, so a loan may collect several decided requests over its life while only
one is open. This is also what makes two taps on a slow connection produce one
request: the service checks first and gives a friendly sentence, and the index
refuses the one that races past.

---

## 3. Approving *is* renewing

There is one renewal in this application, `renewLockedLoan`, and both paths run
it:

```
desk button  ──► renewLoan()             ─┐
                                          ├──► renewLockedLoan(tx, actor, …)
approval     ──► decideRenewalRequest()  ─┘
```

Not "the same rules". The same code, in one transaction with the decision. A
rule added to renewal cannot be missed by the request path, because the request
path has no rules of its own.

Inside the approval transaction, in order:

1. Lock the request row (`FOR UPDATE OF r`), scoped to the actor's library
   through its loan.
2. Refuse unless it is still `PENDING`.
3. Lock the loan (`lockActiveLoan`), which also refuses a loan that is no longer
   active.
4. Re-check eligibility, renewal allowance and the overdue policy **against the
   loan as it is now**.
5. Renew: move the due date, increment the count, append a `RENEW` event
   carrying both dates and a note saying it came from a request.
6. Mark the request `APPROVED` with the deciding librarian.
7. Audit.

Any failure rolls all of it back.

### Re-checking at decision time is the point

A request raised on Monday for a book due Tuesday may be answered on Wednesday,
by which time the book is late — and this library's answer to a late book is to
bring it in, not to extend it. The rules are checked twice on purpose: when the
child asks, so they are told straight away rather than waiting for a knowable
"no"; and when the librarian answers, because by then the answer may differ.

### A refused approval leaves the request PENDING

Deliberately. The librarian has learnt something the child could not know. The
next step is theirs — decline it with a reason, or take the book back — and
silently marking it declined would attribute a decision to somebody who never
made one. A `renewal_request.refused` audit row records the attempt.

---

## 4. Concurrency

| Race | What happens |
|---|---|
| A child taps "Ask" twice at once | One request. The second hits the partial unique index and gets *"You have already asked about this book."* |
| Two librarians approve the same request | One wins. The second waits on the request's row lock, reads a row that is no longer `PENDING`, and is refused. **One approval, one renewal, one `RENEW` event.** |
| One approves while another declines | Exactly one succeeds; the loan's renewal count matches whichever won. |
| A librarian renews at the desk while a request is open | The approval is refused — the allowance is already spent — and the loan is renewed exactly once. |
| The loan goes overdue between ask and answer | The approval is refused and the request stays pending. |

All five are tested against real PostgreSQL with genuinely parallel calls, in
`tests/database/renewal-requests.test.ts`.

---

## 5. Ownership and privacy

**The child's action takes a book code, not a loan id.**

```
requestRenewal({ code: "MJCL-B0007" })
```

The code is printed on the book in their hand, which makes it the natural thing
for their screen to send. More importantly, the query that resolves it is scoped
to `member_user_id = the session`, so a code belonging to another child's loan
finds nothing at all. There is no id on the page to tamper with, no ownership
check to forget, and no member id anywhere in the request.

Every miss returns the same sentence — *"We could not find that book on your
shelf."* — whether the book does not exist, belongs to somebody else, or has
already been brought back. A child probing codes learns nothing.

What a child can see: their own loans, and the state of their own asking. A test
signs in as a second reader and confirms the first child's request is absent
from their screen entirely.

What the librarian's list carries: reader name, card number, title, book code,
current due date, when they asked, and whether the rules allow it. **No guardian
name, no contact detail, no account status, no member id.** A request to keep a
book for a fortnight is not an occasion to put somebody's phone number on a
screen. A test asserts the row object contains none of those keys.

The librarian's decline note is the library's own record. The child's screen
shows one kind sentence — *"The librarian would like this one back. Please bring
it in."* — and not the note verbatim; a test asserts the note does not reach the
reader's payload.

---

## 6. Permissions

| Key | Held by | Means |
|---|---|---|
| `loan.request_renewal` | Reader, Super Admin | Ask about **your own** loan, and cancel your own ask |
| `loan.renew` | Librarian, Junior Librarian, Super Admin | Extend a loan — at the desk, or by approving a request |

There is no separate "decide requests" permission, and that is a decision
(ADR-030): approving a request does exactly what the desk button does, through
exactly the same transaction, so a second key would describe the same power
twice and let the two drift apart.

A reader holds none of `loan.issue`, `loan.return`, `loan.renew`,
`loan.correct` — the whole write surface of circulation — and a unit test says
so. Asking is not deciding.

`/desk/renewals` is guarded by `loan.renew`, never by `loan.view`, which every
reader holds (ADR-026).

---

## 7. Audit

| Action | When |
|---|---|
| `renewal_request.created` | A child asks |
| `renewal_request.approved` | Approved — alongside the `loan.renewed` row the renewal itself writes |
| `renewal_request.declined` | Declined, with the reason |
| `renewal_request.cancelled` | The child withdrew it |
| `renewal_request.refused` | An approval the rules turned down. Written outside the rolled-back transaction, like `loan.issue.refused` |

The `RENEW` loan event carries `note: "Approved from a reader's request."`, so
the loan's own history distinguishes a renewal a child asked for from one a
librarian did at the desk.

---

## 8. The screens

**Child — `/my-books`.** Under each borrowed book: one sentence and one button.

- Can ask → *"You can ask the librarian to keep this book for another 14 days."*
  with **Ask to keep it**. The number comes from `renewal_period_days`.
- Already asked → *"You have asked to keep this one longer. The librarian will
  let you know."* and a quiet **Actually, never mind**.
- Answered → *"The librarian said yes! You can keep this one longer."* or
  *"The librarian would like this one back. Please bring it in."*
- Cannot ask → a sentence, not a disabled button. *"You have already kept this
  one for longer once. Please bring it back."* or *"This one was due back
  already. Please bring it in — you can borrow it again after."*

No status names, no policy language, no ids, no dates the librarian has not
agreed to.

**Librarian — `/desk/renewals`.** One row per pending ask, oldest first, with a
badge on the desk nav and a card on the desk landing page. **Yes, keep it** is
one press. **Not this time** asks for a short note first, because the child is
told something either way and somebody has to have written it.

A request the rules will not allow is still shown, with the reason beside it —
a librarian who can see the rule can explain it to the child, while one who
finds a greyed-out button has to guess.

---

## 9. Not built

No email when a request is decided. The child sees it on their own screen, and a
message to a parent about a fortnight's extension would be noise — and inventing
a notification type was explicitly out of scope. If a library later wants one,
it is a template and a call, not an architecture.

No holds, no queue, no "somebody else is waiting" state — there are no
reservations in Version 1, so `renewal_blocked_when_reserved` remains dormant
and undefined (see `docs/CIRCULATION.md` §10).

No renewal requests from a guardian: guardians cannot sign in in Version 1.

No bulk approve. Five requests on a busy Saturday is five presses, and a bulk
control over a rule-checked decision is how a librarian approves something they
did not read.
