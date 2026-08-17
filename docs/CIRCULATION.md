# Circulation

Issuing, returning and renewing. The moment a book leaves the room in a child's
bag, and the moment it comes back.

---

## 1. The four rules

**The physical copy is what circulates.** A loan points at a `book_copy`, never
at a `book_title`. Three copies of *The Jungle Book* are three things that can
be borrowed, and borrowing `MJCL-B0007` says nothing whatever about
`MJCL-B0012`. No code path resolves a title to "a copy" on the caller's behalf —
the librarian picks the object they are holding.

**There is one source of truth, and the database keeps it.**

```
a copy reads BORROWED  ⟺  that copy has exactly one ACTIVE loan
```

That is not a convention the service maintains carefully. It is a deferred
constraint trigger (`prisma/sql/005_circulation.sql`) which refuses to let an
incoherent transaction commit at all. `AVAILABLE + active loan` and
`BORROWED + no loan` are unrepresentable, not merely unlikely.

**Overdue is derived, never stored.** No column, no loan status, no nightly job
that could fail and leave the library believing something untrue. A loan is
overdue when it is ACTIVE and its stored due date has passed, evaluated in the
library's timezone. A book becomes overdue at midnight without anything having
to run, and stops being overdue the instant it is returned.

**Nothing is rewritten.** A returned loan keeps its issue date, its original due
date and every event that happened to it. Borrowing the same copy again creates
a *new* loan; it never reopens the old one.

## 2. The lifecycle

```
                   issue                     return
   AVAILABLE ───────────────▶ BORROWED ───────────────▶ AVAILABLE
       ▲                    (loan ACTIVE)                    │
       │                          │                          │
       │                          │ renew (dueAt moves)      │
       │                          └──────────┐               │
       │                                     ▼               │
       │                              still ACTIVE           │
       │                                                     │
       │              cancel (mis-issue)                     │
       └─────────────────────────────────────────────────────┘
                                                    return, damaged
                                                          │
                                                          ▼
                                                       DAMAGED
```

Three loan statuses and no more:

| Status | Means | Closing timestamp |
|---|---|---|
| `ACTIVE` | The child has it | none |
| `RETURNED` | It came back | `returned_at` |
| `CANCELLED` | It should never have gone out | `cancelled_at` |

**Overdue is not on this list.** Neither is LOST: "lost" is a fact about a
physical book, which is what `CopyStatus` is for. Conflating them would give the
library two places to ask "where is it?" and let them disagree.

A CHECK constraint ties each status to exactly one closing timestamp, so
"returned but we do not know when" and "cancelled and also returned" cannot be
stored.

## 3. Events

`loan` is current state; `loan_event` is the immutable story. Events append,
never overwrite.

| Event | Written when |
|---|---|
| `ISSUE` | The book goes out. Carries `new_due_at`. |
| `RENEW` | The date moves. Carries **both** `previous_due_at` and `new_due_at`. |
| `RETURN` | The book comes back. |
| `CANCEL` | A mis-issue is reversed. Carries the reason somebody typed. |
| `MARK_DAMAGED` | A librarian's condition change on return. |
| `CORRECT` | Reserved for an audited administrative repair. |

A database CHECK refuses a `RENEW` event that does not carry both dates, which
is what stops a renewal quietly erasing a loan's original due date.

## 4. Issue

### The workflow

`/desk/circulation`. Find the reader, find the book, check the card, hand it
over. Everything lives in the query string, so the whole flow works with
JavaScript switched off, the browser's back button steps backwards through it,
and a half-finished issue can be handed to a colleague as a link.

The confirmation card shows the reader, their card number, the book, its author,
its **Book ID**, its condition and the resulting due date — computed on the
server, in the library's timezone — before anything is written.

### What blocks an issue

Checked in the preview so the desk can explain it, and checked again inside the
transaction while holding row locks, because the shelf can change between a
librarian reading the screen and pressing the button.

| Condition | What the desk is told |
|---|---|
| Librarian lacks `loan.issue` | Refused before any work is done |
| Reader's account is anything but ACTIVE | "This library account is currently unavailable for borrowing." |
| Copy is in another library | Not found — the id is not confirmed to exist |
| Copy is BORROWED | "Someone just got there first — this book is already out." |
| Copy is LOST | "This book is marked as missing. Find it and put it back on the shelf first." |
| Copy is DAMAGED, or its condition is DAMAGED | "This book is marked as damaged. Mend it and change its condition before lending it out." |
| Copy is ARCHIVED | "This book is no longer part of the library." |
| Reader is at the loan limit | "Aarav already has 2 books borrowed. Please return one before borrowing another." |

Note what the account message does **not** say. Why an account is paused is the
library's business and a conversation with the family; it is never a tooltip.
Every refused state gets the same sentence, so the desk screen cannot be read
backwards into a family's paperwork.

### Only ACTIVE members may borrow

| Account state | May borrow | Why |
|---|---|---|
| `INVITED` | ❌ | Set up but not finished. The guardian has not completed activation, so nobody has yet confirmed this child is enrolled on the terms the family agreed to. |
| `ACTIVE` | ✅ | The only state that lends. |
| `SUSPENDED` | ❌ | Paused by the library. |
| `DEACTIVATED` | ❌ | Switched off. |
| `ARCHIVED` | ❌ | Gone from the library's active roll. |

The rule is written as an **allowlist of one** in `src/lib/circulation.ts`, not
as a list of blocked states, and the direction matters. A denylist has to be
kept in step with the enum: add a state and forget the circulation rule, and the
new state silently gains the right to take books home. An allowlist fails the
safe way round — a new state cannot borrow until somebody decides it should, on
purpose, in that file. A unit test asserts the list has exactly one member, and
a database test issues against all five.

It is enforced server-side, inside the transaction, after the member's row is
locked — not in the desk's rendering. The desk's `canBorrow` flag exists so a
librarian is told before they try; it is not what stops them.

**INVITED changed in the Phase 3 correction.** It was briefly allowed, on the
reasoning that a card is issued at approval and activation only governs signing
in. That was the wrong way round for a children's library: it lends the book
first and completes the family's paperwork afterwards. The remedy is quick and
it belongs to the librarian standing there — finish the activation, then lend
the book.

### The damaged rule

A book whose condition is `DAMAGED` is not issued, full stop. There is no
"issue anyway" checkbox. The way to make it issuable is for a librarian to look
at the physical object, mend it, and change its condition to Good or Fair — a
deliberate human judgement that writes an audit row. A damaged book cannot
become available as a side effect of somebody trying to lend it.

### The lost rule

A `LOST` copy cannot be issued, and attempting to issue one does not find it.
Recovering it is an explicit act by a librarian holding the book. Nothing in
circulation ever turns LOST into AVAILABLE automatically — including a return,
which cannot encounter a lost copy anyway, because the invariant means a copy
with an active loan reads BORROWED.

### The archived rule

An archived copy cannot be issued and does not appear in the desk's search at
all — it is not part of the collection, so offering it would be offering a book
that is not in the room. Its historical loans remain intact, and a copy with an
active loan cannot be archived.

### The transaction

One transaction, in this order:

1. **Lock the reader's row** (`SELECT … FOR UPDATE`).
2. Revalidate their account status.
3. **Lock the copy's row.**
4. Revalidate the copy's status and condition.
5. Revalidate the loan limit — this count is current, because any competing
   transaction has either committed or is still waiting on step 1.
6. Revalidate that no active loan exists for the copy.
7. Create the loan, the `ISSUE` event, set the copy to BORROWED, write the audit
   row.

Any failure rolls all of it back. There is no partial loan.

**Lock order is member, then copy. Always.** Two concurrent issues queue behind
the same first lock rather than each holding what the other wants, so this
cannot deadlock. Nothing else in circulation locks a member row, which keeps the
ordering trivially consistent across the whole module.

## 5. Due dates

Computed once, when the loan is created, and then **stored**:

```
due_at = end of day, in the library's timezone,
         borrowing_period_days after the issue date
```

Issued 17 August with a 14-day period → due **31 August**, at 23:59:59
Asia/Kolkata.

Normalised to end of day so that a book issued at 9am and one issued at 6pm on
the same day come back on the same day, which is how a physical library actually
works.

**Never re-derived from current settings.** If the library later changes the
borrowing period from 14 days to 21, every loan already in a child's bag keeps
the date it was given. Only new loans use the new number.

**The browser never calculates a due date.** A laptop with the wrong clock, or a
family reading the app from another country, must not be able to produce a
different answer from the book on the shelf.

## 6. Overdue

```
overdue  ⟺  status = 'ACTIVE'  AND  due_at < now()
```

Evaluated in the library's timezone by `loanCondition()` in
`src/lib/circulation.ts` — one function, read by the desk's filter, the child's
card and the tests, so they cannot disagree.

The desk's `Late` filter is the same expression in SQL, against a partial index
on active loans. "Days overdue" is derived at read time and never persisted; a
number written into a column would be wrong by morning.

**A returned book is never currently overdue**, however late it came back.
Whatever happened, it is over.

### What a child reads

The library charges no fines and never will, and the copy is the only place that
promise is visible to the person it is a promise to.

| | |
|---|---|
| Badge | 🏠 **Ready to come home** |
| Sentence | *This book was due back on 13 Aug. Please return it when you can.* |

Not "OVERDUE". Not a count of days. Not an exclamation mark. A unit test asserts
the absence of *overdue, late, fine, penalty, owe, must, warning* and `!` from
every string a child can see, and asserts that no message anywhere in the module
contains *fine, fee, charge, penalty, pay* or *owe* as a whole word.

The desk sees "6 days over", because the person reading that screen is deciding
who to remind.

## 7. Return

The return screen shows the child, the book, its ID, the issue date, the due
date and whether it is late. One button for the ordinary case.

On return, in one transaction: the loan becomes `RETURNED` with a timestamp and
the returning librarian, a `RETURN` event is appended, the copy goes back to
`AVAILABLE`, and an audit row is written.

**Nothing about the loan's past is touched.** The issue date, the original due
date and every renewal stay exactly as they are.

### Condition on return

"Check it first" opens a condition control whose default is **leave it as it
is** — not Good. A book that went out Fair comes back Fair unless a librarian
actually looked at it, because "we got it back" is not evidence that it is in
better shape than it was.

A book that comes back **damaged** goes to `DAMAGED`, not `AVAILABLE`, so the
next child is not handed something falling apart. Getting it back on the shelf is
then a deliberate act. The condition change writes both a `MARK_DAMAGED` loan
event and a `book.copy.condition_changed` audit row.

## 8. Renewal

```
new due date = renewal_period_days after the CURRENT due date
```

Not after today. A child who renews three days early keeps those three days
rather than being quietly punished for coming to the desk promptly.

Worked example, with this deployment's settings:

```
issued  17 August      due  31 August      (borrowing_period_days = 14)
renewed                due  14 September   (renewal_period_days   = 14)
```

The original due date is not lost: it goes into the `RENEW` event as
`previous_due_at`, and the issue date is untouched. A renewed loan is the same
loan, kept longer.

### What blocks a renewal

* the loan is not ACTIVE;
* `renewal_count` has reached `max_renewals`;
* the reader's account is suspended, deactivated or archived;
* the loan is overdue and this library does not renew overdue loans.

There is no reservation system in Phase 3, so nothing is ever blocked by
somebody else waiting.

### Overdue and renewal

**Policy: a book past its date is not renewed.** `allow_renewal_when_overdue`
defaults to `false`.

The reasoning is that "renew" should mean *you still have it and we know where
it is*. A late book comes to the desk, the librarian takes it back, and it may go
straight out again in the same minute — the same outcome, reached with somebody
holding the book and looking at it.

It is a setting rather than a constant because it is a community's decision, and
a library that would rather a child renewed than kept a book silently can change
one row. The desk's button reads **"Return it first"** when the policy blocks it,
so a librarian can see the rule exists and tell the child why.

## 9. Cancellation — and why there is no general correction screen

A loan may need reversing: the wrong book, or the wrong child, noticed thirty
seconds later. That is `cancelLoan`, guarded by `loan.correct`, and it **requires
a reason**.

Nothing is deleted. The loan becomes `CANCELLED`, keeps its issue date and every
event, gains a `CANCEL` event carrying the reason, and the copy returns to
`AVAILABLE` with its condition untouched. A cancelled loan does not appear in a
child's reading history — it is a loan that should never have existed — but it
stays in the library's records and in the audit log.

**Phase 3 deliberately does not build a general "correct the circulation state"
screen.** The state such a screen would exist to repair — a copy reading BORROWED
with nobody holding it, or AVAILABLE while a loan is open — cannot occur, because
the deferred constraint trigger refuses to commit it. Building a repair tool for
an unreachable state would mean building a way to reach it. If that judgement
turns out to be wrong in practice, the mechanism to add is another audited,
reason-required action alongside cancellation — never a generic status dropdown
that bypasses circulation.

The one genuine scenario the brief anticipated — *a book was physically returned
but the system failed before recording it* — is just a return, performed now.

## 10. Limits and configuration

Every circulation rule is a column in `library_settings`. Nothing under `src/`
writes `14`, `2` or `1` into a business decision.

| Setting | Platform default | This deployment |
|---|---|---|
| `borrowing_period_days` | 14 | **14** |
| `max_active_loans` | 2 | **2** |
| `max_renewals` | 1 | **1** |
| `renewal_period_days` | 7 | **14** |
| `allow_renewal_when_overdue` | false | **false** |
| `timezone` | Asia/Kolkata | **Asia/Kolkata** |

`renewal_period_days` differs from the platform default on purpose: 14 makes one
renewal double the loan, matching the worked example above. It is a judgement,
and it is flagged for the owner's approval in `docs/PHASE-3.md`.

The loan-limit message is generated from the setting, so a library that lends
four books gets a message that says four, and one that lends a single book gets a
sentence that reads correctly in English.

### Settings that exist and do nothing

Three columns in `library_settings` came from the blueprint's sketch of a
complete library system and have never been implemented. **Changing any of them
has no effect whatsoever.**

| Setting | Why it is dormant |
|---|---|
| `block_on_overdue_days` | Would refuse to lend to a child with something this many days overdue. That turns a late book into a closed door for a nine-year-old, and whether this library wants that is the owner's decision — not a default the code should assume. |
| `renewal_blocked_when_reserved` | There are no reservations in Version 1, so there is no state for it to describe. |
| `overdue_reminder_offsets` | Phase 3 sends no notifications of any kind. |

Two permissions are in the same position: **`loan.override_rules`** and
**`loan.mark_lost`** are seeded, grantable, and read by nothing. A copy's status
and condition are changed through the catalogue under `book.edit`.

They are listed as dormant in code — `DORMANT_CIRCULATION_SETTINGS` in
`src/lib/circulation.ts`, `DORMANT_PERMISSIONS` in `src/lib/permissions.ts` — and
their permission descriptions say "Not yet implemented" in as many words. Tests
assert that nothing under `src/` reads any of them.

There is **no settings screen in Version 1**, so none of these is currently
rendered anywhere; a librarian cannot tick a box and go home believing the
library behaves differently. The lists exist so that whoever builds that screen
has to decide what to do about these fields rather than discovering the problem
afterwards. A control that looks like a rule and is not one is worse than a
missing feature: it is a promise the software breaks silently.

Implementing one means defining its semantics, and those are the owner's to
define. Take a name off the dormant list in the same change that makes it do
something — a test fails if only one of the two happens.

## 11. Concurrency

Two librarians on two tablets, a double-tapped button, a slow network retry. The
interesting failures are never the ones a single request can produce.

| Race | What stops it |
|---|---|
| Two children, one book | `SELECT … FOR UPDATE` on the copy, plus the partial unique index `one_active_loan_per_copy` |
| One child at the limit, two books at once | `SELECT … FOR UPDATE` on the **member row**, taken before the count |
| The same book returned twice | `FOR UPDATE OF l` on the loan, then a status re-check |
| The same loan renewed twice | The same lock, then a `renewal_count` re-check |
| A return and a renewal at once | The same lock; only one leaves ACTIVE |
| A return and a cancellation at once | The same lock, plus the CHECK that only one closing timestamp may be set |

The member lock is the one that is easy to miss. Counting a child's active loans
without it would let two simultaneous requests both read "1 of 2" and both
succeed, leaving a child with three books. With it, the second waits, re-reads
after the first commits, and sees 2.

`tests/database/circulation-concurrency.test.ts` fires all of these in parallel
against real PostgreSQL and asserts the state the database is left in, rather
than which caller happened to win.

## 12. Permissions

| Permission | Held by |
|---|---|
| `loan.view` | Super Admin, Librarian, Junior Librarian, **and every Reader** |
| `loan.issue` | Super Admin, Librarian, Junior Librarian |
| `loan.return` | Super Admin, Librarian, Junior Librarian |
| `loan.renew` | Super Admin, Librarian, Junior Librarian |
| `loan.correct` | Super Admin, Librarian |
| `loan.override_rules` | Super Admin, Librarian — **dormant: granting it changes nothing** |
| `loan.mark_lost` | Super Admin, Librarian — **dormant: granting it changes nothing** |

### ⚠ `loan.view` may never guard a staff screen

Every reader holds it — it is what lets a child see their own books — so a desk
screen guarded by `loan.view` would hand any nine-year-old the whole library's
loan list with every borrower's name on it.

The desk queries therefore require `["loan.issue", "loan.return", "loan.renew"]`,
which no reader holds. This is the same trap `book.view` set in Phase 2, and it
is written down twice on purpose. A test asserts a member cannot reach
`listLoansForStaff`, `countDeskLoans`, `searchReaders` or `searchCopies`.

The reader's own view is safe for a structural reason as well as a permission
one: `listOwnLoans()` **takes no member id at all**. It reads the session. There
is no "whose loans?" parameter to get wrong and no id in a URL to increment.

Readers hold **no circulation mutation permission**. A child never issues,
returns, renews or cancels anything, in this phase or any other. A unit test
asserts every permission a member holds ends in `.view`.

### Junior Librarian

Seeded and still not assignable. It now holds `loan.view`, `loan.issue`,
`loan.return`, `loan.renew`, `member.view` and `book.view` — enough to run the
desk. It does **not** hold `loan.correct`: handing books out is a child
volunteer's job; rewriting the library's account of what happened is not.
`loan.correct` is in `PERMISSIONS_FORBIDDEN_FOR_CHILD_STAFF`, which a test
enforces.

## 13. Privacy

**No reader-facing surface names a borrower.** There is no function anywhere in
this application that answers "who has this book?" to a child. `copyIsOnLoan()`
returns a boolean and nothing else — a child looking at a borrowed book learns
that somebody is reading it, which is true, useful, and the end of it. No name,
no card number, no due date, no "back on Tuesday" that a determined child could
use to work out which friend has it.

A child cannot see another child's books, history or overdue status, and the
guarantee is the shape of the query rather than a check that could be forgotten.

**The desk sees the minimum.** Reader search returns a name, a card number, a
picture and how many books they already have. No guardian, no phone, no email,
no date of birth, no apartment — and apartment is deliberately not searchable
either. A desk that offers "show me everyone in B-402" is a directory of who
lives where with whom.

**Donor acknowledgement stays independent of circulation.** A child's own book
card shows who gave the book, exactly as the book's page does. Nowhere does the
application render "donated by X and borrowed by Y": the donors page has no
borrower column to add one to, and no donor-facing view carries a borrower at
all.

## 14. Audit

Written inside the same transaction as the change, so a rolled-back change
cannot leave a record of itself and a committed one cannot be missing.

| Action | Notes |
|---|---|
| `loan.issued` | copy code, reader, due date, loan period |
| `loan.issue.refused` | **written outside the transaction**, so a refusal survives the rollback |
| `loan.returned` | copy code, due date, return date, resulting condition and status |
| `loan.renewed` | previous and new due date, which renewal this was |
| `loan.cancelled` | the reason, and the original issue date |
| `book.copy.condition_changed` | when a return changes a condition |

`loan.issue.refused` is there because a refusal is the interesting event when a
family later asks why a child came home empty handed — and it is the only trace
an attempted bypass of the desk's rules leaves.

Nothing logs a password, a token or a session secret; `redactMetadata` strips
anything that looks like a credential regardless of what a caller passes.

Historical loan events are never rewritten because a book's metadata changed
later. The audit row links by `entity_id`, so a loan's history survives a title
being corrected.

## 15. Notifications

**None are sent in Phase 3.** The architecture is ready for due-soon, overdue and
return-confirmation messages — `overdue_reminder_offsets`,
`overdue_reminders_enabled` and the existing email provider abstraction are all
in place — but no circulation template exists and nothing is dispatched. Adding
them means writing templates against `EmailService`, and development continues to
use the existing local mail transport.

The daily maintenance job is not, and must never become, the source of truth for
overdue. It may one day send reminders; the answer to "is this late?" stays a
read-time derivation.

## 16. What Phase 3 deliberately does not include

Reservations, waiting lists, holds, fines, late fees, payments, ratings, reviews,
reading challenges, recommendations, social features, a parent dashboard,
notifications, barcode scanning, RFID, and external library integrations.

`renewal_request` — the table that would let a child *ask* to keep a book longer
— exists from Phase 0 and remains unused. Renewal in Phase 3 is a librarian
action at the desk. Wiring the request flow is a later decision, not an omission.
