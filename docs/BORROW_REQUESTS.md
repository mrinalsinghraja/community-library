# Asking for a book

A child finds a book in the catalogue and asks for it. A librarian answers.
Between those two things, **nothing moves** — and that gap is the feature.

See ADR-038 for the decision, `src/server/services/circulation-service.ts` for
the code, and `docs/CIRCULATION.md` for the loan rules an approval runs into.

## The rule this exists to teach

The books are physical objects on shelves in the Mana Jardin apartment yoga
room. A child can visit, browse the shelves and read there. **A book leaves the
room when a librarian hands it over, and not before.**

Finding a book on a screen is not taking it off the shelf. Every surface says
so, in one shared sentence (`BORROW_REQUEST_MESSAGES.collectionNote`) that the
rules page, the book page and the child's own shelf all render — so the three
cannot drift apart.

## What a request is

A row in `borrow_request` with a copy, a child, and `PENDING`. That is all.

The copy stays `AVAILABLE`. No loan exists. No due date is calculated. Nothing
in the library's account of where its books are has changed, because no book has
gone anywhere.

## The rules a child meets when asking

| Rule | What the child is told |
|---|---|
| The copy must be on the shelf | "This book is not on the shelf right now." |
| Somebody else may already be waiting for it | "Someone has already asked for this one. Try again in a few days." |
| They may not ask twice for the same copy | "You have already asked for this book." |
| Loans plus pending asks must be under the limit | "You can have 2 books at a time. Bring one back and you can ask for another." |
| Their account must be active | "Please ask the librarian about your library card." |

A pending request counts against the borrowing limit alongside active loans.
Without that a child could ask for nine books and the librarian would have to be
the one saying no eight times.

A child can take a request back while it is pending. It becomes `CANCELLED` and
stays, so a librarian who saw it in the morning can find out what happened, and
the copy is free for somebody else to ask about.

## The queueing model

One partial unique index:

```sql
CREATE UNIQUE INDEX "borrow_request_one_pending_per_copy"
    ON "borrow_request" ("copy_id")
 WHERE "status" = 'PENDING';
```

That is the whole of it. **One child at a time may be waiting for one physical
book.** There are no holds, no reservations, no waitlists and no queue
positions: a library of a few hundred books in an apartment does not need a
reservation engine, and a queue a child can see themselves sixth in is a
disappointment machine.

The index is raw SQL and therefore invisible to `prisma migrate diff`. It is
recorded in `prisma/sql/007_v1_role_model_and_borrow_requests.sql`. **If
`prisma migrate dev` ever regenerates the migration, it is lost.**

## The librarian's side

`/desk/requests`, guarded by `loan.issue` — the authority to hand a book to a
child, which is exactly the authority to say yes to one of these. Not
`loan.view`, which every reader holds and which would put a list of every
asker's name in front of a nine-year-old.

Each row shows who asked, which book, when, and whether the rules allow it
today. Nothing about the family and no contact details.

**Approving issues the book.** It calls `issueLockedLoan`, the same function the
desk's Issue button calls, in the same transaction as the decision. The
borrowing limit, the ACTIVE-member rule, the copy's condition and the
one-active-loan-per-copy index are all enforced without this path knowing any of
them — which is the point: a rule added to issuing cannot be missed here,
because there is no second way to lend a book.

The librarian then hands over the object, which is the part no software can do.

**Declining requires a short note**, because the child is told something either
way and somebody has to have written it. The note appears on the child's own
books page in the librarian's own words.

**A refused approval leaves the request PENDING.** The librarian has learnt
something the child could not — the book came back damaged, the child already
has two out — and the next step is theirs: decline it with a reason, or fix the
problem and approve. Marking it declined on their behalf would attribute a
decision to somebody who never made one.

## Concurrency

| Two things at once | What stops it |
|---|---|
| Two children ask for the same copy | `borrow_request_one_pending_per_copy`; the loser is told the book is spoken for |
| One child double-taps the button | The same index, and a friendlier check before it |
| Two librarians approve the same request | `SELECT … FOR UPDATE` on the request row; the second reads a row that is no longer PENDING |
| Approval races the desk issuing the same copy | The issue path's own member-then-copy lock order, unchanged and shared |

## Audit

`borrow_request.created`, `.approved`, `.declined`, `.cancelled` and `.refused`.
The refusal row is written outside the transaction that rolled back, for the
same reason a refused issue is: the rollback must not take the record of the
attempt with it.
