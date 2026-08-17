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

`MJCL-B0010` was reset to `AVAILABLE`, **and an audit row was written naming
it**, by step 1 of the Phase 3 migration.

No borrower was invented. A fabricated loan would put a child's name against a
book they may never have touched, and that name would then sit in their
borrowing history permanently. Better that a librarian walks to the shelf.

The reconciliation lives in the migration rather than in a one-off script for
two reasons. It has to run *before* the invariant trigger is installed, or the
trigger's first encounter with such a row would be a failure at a busy desk. And
production faces the identical situation for the identical reason — it has no
loans either, so any BORROWED copy there is also a hand-set Phase 2 status with
nobody attached. Resetting it and recording which book it was is the only
truthful option available.

The statement is idempotent: on a database with no such rows it updates nothing
and writes nothing.

```sql
-- The audit row each reconciled copy gets
{
  "copyCode": "MJCL-B0010",
  "from": "BORROWED",
  "to": "AVAILABLE",
  "reason": "Marked borrowed before circulation existed, with no loan and so no
             borrower. Reset to available rather than inventing one — please
             check the shelf for this book."
}
```

**Action for the librarian:** the audit log now lists which books need a
physical check. Query it with the SQL in `docs/OPERATIONS.md`.

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

**5. INVITED readers may borrow.** The brief listed suspended, deactivated and
archived as the blocking states, and INVITED is none of them. A card is issued at
approval; whether a guardian has clicked an activation link governs signing in,
not taking a book home.

**6. `loan.override_rules` is seeded but wired to nothing.** It existed from
Phase 0. A half-designed bypass of the loan limit seemed worse than an unused
permission — say if you want it to do something.

**7. `block_on_overdue_days` is not wired to issuing.** The blueprint sketched
"a child with a book overdue by more than N days cannot borrow another". The
brief's issue-validation list (§16) does not include it, and it is a
consequential rule — it stops a specific child borrowing anything at all — so it
was not invented. An overdue book blocks *renewal*; it does not currently block
*borrowing*. The column stands unused and ready. Say if you want it on, and at
what number.

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
