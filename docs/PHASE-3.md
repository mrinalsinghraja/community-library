# Phase 3 — circulation

Issue, return, renew, due dates, overdue, borrowing history.

Read `docs/CIRCULATION.md` for how it works. This file is what changed, what was
decided, and what the owner needs to look at.

---

## 1. Reconciliation of existing data — done first

Phase 2 let a librarian pick `Borrowed` as a book status, so a database upgraded
from it may hold copies that read BORROWED with **no loan and therefore no
borrower**. Circulation cannot start on top of that.

### What was found

The development database was inspected before anything was changed:

| | |
|---|---|
| Book copies | 12 |
| `AVAILABLE` | 11 |
| `BORROWED` | 1 — `MJCL-B0010`, *The Jungle Book*, condition Fair |
| Loans | 0 |
| Loan events | 0 |
| Renewal requests | 0 |
| Readers | 3 (`MJCL-R0001`, `MJCL-R0002`, `MJCL-R0003`) |

So exactly one copy was in the transitional state, and it was a demo fixture:
the demo seed only ever writes `AVAILABLE`, and this status was set by hand
during the Phase 2 browser walkthrough.

### What was done, and why

> **Corrected after review.** The first implementation reset such a copy to
> `AVAILABLE` inside the migration. That was right for a demo fixture and wrong
> as a deployment behaviour, and it has been replaced. What follows describes
> the current design.

**The migration refuses to run.** Step 0 installs
`circulation_assert_no_stranded_copies()` and calls it. If any copy reads
BORROWED with no active loan, the migration stops there having changed nothing
else:

```
ERROR: Cannot enable circulation: 1 book(s) read BORROWED with no loan and so
       no borrower (MJCL-B0010). Someone must find out where each one is;
       a deployment must not guess.
```

The reasoning is that both automatic repairs are lies the deployment is not
entitled to tell. Resetting to `AVAILABLE` asserts the book is on the shelf, and
a deployment has no way of knowing that — the book may be in a child's bag, and
the next reader would be promised something nobody can hand them. Writing a loan
asserts a particular child has it, which nothing in the database knows; the
invented borrower would sit in a real child's history permanently. **A
deployment must never silently make a physically borrowed book appear available,
and must never invent a borrower.**

**The decision belongs to a person who can walk to the shelf.**
`npm run reconcile:circulation` lists what needs deciding and changes nothing.
Each book is then resolved explicitly, with the operator's name and reason
recorded in the audit log:

| What they found | Command | Copy becomes |
|---|---|---|
| It is on the shelf | `--on-shelf` | `AVAILABLE` |
| A named child has it | `--with MJCL-R0007 --issued … --due …` | stays `BORROWED`, with a real loan carrying the real dates |
| Nobody knows where it is | `--missing` | `LOST` |

`LOST` is the honest third answer, and it is what makes refusing viable: the
library does not have the book, does not know who does, and now says so. No
child is named, and no reader is promised the book.

The full procedure is in `docs/OPERATIONS.md`, "An inconsistent circulation
state". The guard function stays installed after the migration so an operator
can re-run it to confirm they are finished.

**The development database.** `MJCL-B0010` was reset to `AVAILABLE` — the same
decision as before, now made explicitly rather than by the deployment, because
it is known demo data: the demo seed only ever writes `AVAILABLE`, and that
status came from the Phase 2 browser walkthrough. No borrower was invented then
and none is now.

**Production is not the same situation as development**, which is why the two
are no longer handled by the same code. Development knew what that record was.
Production does not.

> **Migration 6 was edited in place, so its checksum changed.** That is only
> safe because nothing is deployed: the sole databases that had ever applied it
> were the local development and test ones, and both were rebuilt from the six
> migrations and reseeded. Any database that had applied the earlier version
> would report `migration ... was modified after it was applied` and would need
> the same treatment. If this had already been live, the correction would have
> had to arrive as migration 7 instead.

Proved by test (`tests/database/circulation-reconciliation.test.ts`): the guard
detects the state, names the book, leaves the copy BORROWED, creates no loan and
no loan event, and passes once resolved. Two further tests read the migration
file itself and assert it contains no statement that writes `book_copy` and no
audit row written on the library's behalf — a regression guard against the
silent repair coming back.

## 2. Database changes — migration 6

`20260817200000_phase3_circulation`. Hand-corrected after
`prisma migrate diff`; three things needed a human.

| Change | Detail |
|---|---|
| Reconciliation | Step 1, above. Runs before the trigger exists. |
| `LoanStatus` | `ACTIVE, RETURNED, LOST, WRITTEN_OFF` → **`ACTIVE, RETURNED, CANCELLED`** |
| `LoanEventType` | `ISSUE, RENEW, RETURN, MARK_LOST, MARK_DAMAGED, ADJUST_DUE` → **`ISSUE, RENEW, RETURN, CANCEL, MARK_DAMAGED, CORRECT`** |
| `loan` | `+ cancelled_at`, `+ cancelled_by_id` (FK to `app_user`, `SET NULL`) |
| `library_settings` | `+ allow_renewal_when_overdue boolean NOT NULL DEFAULT false` |
| CHECK | `loan_closing_fields_match_status` replaces `loan_return_fields_match_status` |
| CHECK | `loan_cancelled_after_issue` |
| CHECK | `loan_event_renewal_moves_the_date`, `loan_event_note_is_short` |
| Trigger | `loan_keeps_copy_coherent` + `copy_status_matches_its_loan`, both `DEFERRABLE INITIALLY DEFERRED` |
| Index | `loan_active_by_due_date_idx` — partial, `WHERE status = 'ACTIVE'` |
| Index | `app_user_display_name_trgm_idx` — trigram, for desk name search |

Rebuilding the enums was safe because no loan has ever been issued. If rows had
existed it would have been `ALTER TYPE … RENAME VALUE`, as migration 2 was for
consent.

### The two things that had to come down first

`loan_return_fields_match_status` names `'LOST'` and `'WRITTEN_OFF'` literally,
and altering the column's type re-parses that expression against an enum that no
longer has them.

The subtler one: **the partial unique index `one_active_loan_per_copy`**. Its
predicate is `WHERE status = 'ACTIVE'::"LoanStatus"`, and Postgres rebuilds
indexes when a column's type changes — by which point the column is
`LoanStatus_new` while the predicate still says `LoanStatus`:

```
ERROR: operator does not exist: "LoanStatus_new" = "LoanStatus"
```

Prisma's generated SQL cannot know about it, because a partial index is not
expressible in `schema.prisma` and never appears there. It is dropped and
**rebuilt in the same migration** — it is the guarantee that a book cannot be
issued twice, and leaving it for later would open a window.

### Verification

* Applies cleanly to the existing Phase 2 development database ✓
* Applies cleanly to an **empty** database (all six migrations in order) ✓ — this
  is what caught a duplicate index name; `member_profile_code_lower_idx` already
  existed from migration 1, better scoped, and the redundant one was removed
* `prisma migrate diff --from-schema-datasource --to-schema-datamodel` → empty ✓

No loan or loan event was dropped; there were none, and if there had been they
would be the library's own record of what happened.

## 3. What was built

**Domain** — `src/lib/circulation.ts`. Isomorphic vocabulary: loan statuses, the
derived condition, days overdue, every string a child or a librarian reads, page
sizes, filters. No `server-only`, so the service, the components and the tests
share one answer.

**Service** — `src/server/services/circulation-service.ts`. `issueBook`,
`returnBook`, `renewLoan`, `cancelLoan`, `searchReaders`, `searchCopies`,
`getIssuePreview`, `listLoansForStaff`, `countDeskLoans`, `getLoanForStaff`,
`listOwnLoans`, `copyIsOnLoan`.

**Actions** — `src/server/actions/circulation-actions.ts`. Thin; no authorization
decision is made there.

**Screens**

| Route | Who | What |
|---|---|---|
| `/desk/circulation` | `loan.issue` | Find reader → find book → confirm → issue |
| `/desk/loans` | desk permissions | Active / Late / Brought back, search, page, return, renew, cancel |
| `/my-books` | any signed-in reader | Their own books and their own history |

`/desk` gained a Books-out card with an overdue count; the staff nav gained
**Issue** and **Books out** with a late badge; the reader masthead gained
**My books**.

**Catalogue integration.** `BORROWED` left `SELECTABLE_STATUSES` — circulation
owns that transition now. The edit form for a book that is out shows a read-only
note and no status control at all, `updateBook` refuses a status change while a
loan is active (bibliographic edits still work), and `archiveBook` refuses a copy
that is out.

## 4. Decisions requiring the owner's approval

**1. `renewal_period_days` is 14 for this library, against a platform default of
7.** The brief's worked example was *17 Aug → 31 Aug, renewed to 14 Sep*, which
is +14. That makes one renewal double the loan. If the intent was a shorter
second stretch, this is one `UPDATE` on `library_settings`.

**2. Overdue books cannot be renewed** (`allow_renewal_when_overdue = false`).
Recommended in the brief and adopted. A late book comes to the desk, is returned,
and may go straight back out — same outcome, with somebody holding the book.

**3. There is no general "Correct Circulation State" screen.** The incoherent
state such a screen would repair cannot occur, because the constraint trigger
refuses to commit it; building a repair tool for an unreachable state would mean
building a way to reach it. Cancellation — audited, reason-required,
`loan.correct` only — is the correction mechanism. Say if you would rather have a
broader one.

**4. `LoanStatus` lost `LOST` and `WRITTEN_OFF`.** "Lost" is a fact about a
physical book, which `CopyStatus` already carries. Keeping both would give the
library two places to ask "where is it?".

**5. ~~INVITED readers may borrow.~~ Corrected: only ACTIVE members may
borrow.** The first implementation allowed INVITED, reasoning that a card is
issued at approval and activation only governs signing in. That is the wrong way
round for a children's library — it lends the book first and finishes the
family's paperwork afterwards. Now written as an allowlist of one, so a state
added to the enum later cannot inherit the right to borrow. All five states are
covered by tests, and every refused state gets the same sentence.

**6. Dormant configuration is now labelled as such.** Five things exist, are
grantable or settable, and are read by nothing:

| | Why it was not implemented |
|---|---|
| `loan.override_rules` | A half-designed bypass of the loan limit is worse than an unused permission. |
| `loan.mark_lost` | Status and condition are changed through the catalogue, under `book.edit`. |
| `block_on_overdue_days` | It would stop a specific child borrowing anything at all over a late book. Consequential, and the brief's issue-validation list does not include it. |
| `renewal_blocked_when_reserved` | There are no reservations, so there is nothing for it to describe. |
| `overdue_reminder_offsets` | This phase sends no notifications. |

They are declared dormant in code (`DORMANT_CIRCULATION_SETTINGS`,
`DORMANT_PERMISSIONS`), their permission descriptions read "Not yet
implemented", and tests assert nothing under `src/` reads any of them. There is
no settings screen in Version 1, so none is rendered anywhere — the lists exist
so that whoever builds one has to decide about these fields rather than
discovering them afterwards. **No semantics were invented for any of them.** Say
which you want, and what it should mean.

## 5. Tests

**446 passing, up from 351** (166 unit + 280 against real PostgreSQL). Stable
across four consecutive full runs.

| File | Adds |
|---|---|
| `tests/unit/circulation.test.ts` | 20 — the overdue derivation across a timezone boundary, and every word a child reads |
| `tests/database/circulation.test.ts` | 61 — issue, return, renewal, cancellation, privacy, authorization, search, history, catalogue integration |
| `tests/database/circulation-concurrency.test.ts` | 11 — every race, fired in parallel against real Postgres |

Coverage of the brief's list: valid issue · unavailable book · borrowed book ·
lost book · damaged book · mended book · archived book · suspended child ·
deactivated child · loan limit · limit read from settings · duplicate active loan
· concurrent issue · cross-library member · two copies of one title · valid
return · already returned · missing loan · damaged on return · condition never
reset to Good · re-issue as a new loan · valid renewal · maximum renewals ·
overdue renewal blocked · overdue renewal allowed when configured · returned loan
· suspended reader · renewal date calculation · original dates preserved · child
sees own loans · child cannot see another's · no borrower identity anywhere ·
cancelled loans hidden from a child · staff have no card · member cannot issue /
return / renew · member cannot reach the desk despite holding `loan.view` ·
librarian can operate the desk · `loan.correct` required for cancellation · same
book concurrent issue (2 and 10 ways) · same child concurrent issue at the limit ·
five at once from empty · independent children unaffected · concurrent return ·
concurrent renewal · return-vs-renew · return-vs-cancel · the invariant under a
messy afternoon.

Three existing tests changed because the rules changed, not because they broke:
the constraint tests now build coherent loans before attacking them, the
catalogue filter fixture uses `DAMAGED` instead of the no-longer-selectable
`BORROWED`, and the member-permission assertions include `loan.view`.

### The correction pass

**490 passing** (183 unit + 307 against real PostgreSQL), up from 446.

| File | Adds |
|---|---|
| `tests/database/circulation-reconciliation.test.ts` | 17 — the migration's guard, the migration file's own text, and the three operator resolutions |
| `tests/unit/dormant-configuration.test.ts` | 9 — nothing in `src/` reads a dormant setting or permission, and nothing live is mislabelled as dormant |
| `tests/unit/circulation.test.ts` | 6 more — the eligibility allowlist and the one sentence every refusal shares |
| `tests/database/circulation.test.ts` | 11 more — issue and renewal against all five account states, and the desk's own flag |

Building the broken state takes a deliberate act, and that is the point: the
deferred trigger makes it uncommittable through any ordinary path, so the test
disables that trigger for exactly one statement to produce the row a Phase 2
database arrives holding.

## 6. Browser walkthrough

Run against the development server with the demo data.

| Scenario | Result |
|---|---|
| **A — Issue** | Librarian signed in · desk opened · searched `aarav` → *Aarav Sharma, MJCL-R0002, No books out* · searched `gruffalo` → both copies listed and distinguished by code · picked `MJCL-B0001` · confirmation card showed Reader / Book / **Book ID MJCL-B0001** / Condition Good / **Due Monday 31 August 2026 (14 days)** · issued · database shows the loan ACTIVE 17 Aug → 31 Aug, copy `BORROWED`, one `ISSUE` event ✓ |
| **B — Second book** | `MJCL-B0003` issued to the same child; two active loans ✓ |
| **C — Loan limit** | Third book: button disabled, message **"Aarav Sharma already has 2 books borrowed. Please return one before borrowing another."** Forcing the submit past the disabled attribute was still refused server-side, left exactly 2 active loans, and wrote a `loan.issue.refused` audit row ✓ |
| **D — Return** | `MJCL-B0001` returned from the desk · loan `RETURNED` with `returned_at` · issue date, original due date and `renewal_count = 1` all preserved · copy back to `AVAILABLE` · `RETURN` event appended ✓ |
| **E — Renewal** | Renewed `MJCL-B0001`: **31 Aug → 14 Sep**, issue date unchanged, `RENEW` event carrying `previous_due_at = 31 Aug` and `new_due_at = 14 Sep` · row then read *14 Sep 2026 / kept longer once* · second renewal button read **"No renewals left"** and forcing it returned *"This book has already been kept for longer once. Please bring it back to the desk."* ✓ |
| **F — Overdue** | A loan's dates moved into the past with no job run. Desk immediately showed **Late / 6 days over**; the child's screen showed **🏠 Ready to come home** and *"This book was due back on 13 Aug. Please return it when you can."* A test asserts no `%overdue%` column exists on `loan`, `loan_event` or `book_copy`, and that `LoanStatus` is exactly `ACTIVE, RETURNED, CANCELLED` ✓ |
| **G — Privacy** | Signed in as `MJCL-R0001`: `/my-books` showed only their own book. Aarav's overdue *Matilda* was absent, and no other child's name appeared anywhere. `/desk/loans` as a reader redirected to `/account` and leaked nothing ✓ |
| **H — Concurrent issue** | Verified by `circulation-concurrency.test.ts`, which fires genuinely parallel requests through the real services against real PostgreSQL: two at once → exactly one wins; ten at once → exactly one wins; the loser's transaction leaves no partial loan. **In the browser** the second attempt on an out book is refused with *"Someone just got there first — this book is already out."* The browser cannot produce true simultaneity, so the parallel proof is the test, and that is stated rather than implied ✓ |

**Responsive.** 375px, 768px and desktop. No page-level horizontal scrolling —
confirmed by `window.scrollX` staying at 0 after scrolling right, while the wide
desk table scrolls 405px inside its own container. Adding *My books* to the
masthead made a fourth nav item that pushed the page to 459px at 375; the nav now
wraps.

**Console clean.** The only server-log error was a transient HMR miss while the
`conditionLabel` import was being added, gone on the next request and caught by
typecheck.

## 7. Known limitations

* **No notifications.** The architecture is ready; nothing is sent. See
  `CIRCULATION.md` §15.
* **`renewal_request` is unused.** Children cannot request a renewal; a librarian
  renews at the desk. The blueprint's "children only request renewals" flow is a
  later decision.
* **Returning a book from a filtered list gives no lingering confirmation** — the
  row simply leaves the "Out now" list, which is legible but quieter than the
  issue screen's message.
* **There is no per-loan detail screen.** `getLoanForStaff()` exists and returns
  a loan with its full event history; it is covered by tests but not yet wired to
  a page. The desk surfaces what it needs inline — the due date, "kept longer
  once", and the Brought-back filter — so this is a gap in depth rather than in
  function.
* **`loan.override_rules` does nothing.**
* **One transient test failure was observed once** during a run concurrent with a
  dev-server rebuild, and did not reproduce across four subsequent full runs. Not
  explained; watching it in CI.
* **Not deployed.** Still blocked on Neon projects being created — `neonctl`
  needs interactive browser OAuth.

## 8. Stop condition

Issue ✓ · return ✓ · renewal ✓ · due dates ✓ · overdue derived ✓ · loan history ✓
· child My Books ✓ · librarian desk ✓ · loan limit ✓ · concurrency ✓ · privacy ✓ ·
authorization ✓ · audit ✓ · existing BORROWED records reconciled ✓ · all tests ✓ ·
browser walkthrough ✓ · CI ✓

**PHASE 4 HAS NOT BEEN STARTED.**
