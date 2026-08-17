# Phase 2 — the catalogue

The library can now say what it owns, and a child can find it.

**Read this after [`PHASE-1.1.md`](PHASE-1.1.md).** Phase 3 (borrowing) has not
been started. The full field-by-field reference is [`CATALOGUE.md`](CATALOGUE.md).

---

## 1. What Phase 2 is

Five screens and one service:

| Route | Who | What |
|---|---|---|
| `/admin/books` | staff | the list: search, five filters, sort, paging, archive |
| `/admin/books/new` | staff | Add Book — ten fields, about a minute |
| `/admin/books/[copyId]` | staff | Edit, and remove a cover |
| `/books` | readers | "Let's find your next book!" |
| `/books/[code]` | readers | one book, and its thank-you |
| `/donors` | readers | Thank You, Book Donors ❤️ |

Everything reads through `catalogue-service.ts`, which calls
`requirePermission` before it does any work.

## 2. The three decisions worth re-reading

**The physical book is the unit.** `book_title` is what the book *is*;
`book_copy` is the object on the shelf with a code stuck to it. Adding a second
Jungle Book makes a second copy, not a second record. The forms are built around
copies, because that is what a librarian is holding.

**Nothing is destroyed.** There is no delete anywhere. Lost is `LOST`, beyond
mending is `DAMAGED`, permanently gone is `ARCHIVED` — and the code, the
donation and the history all stay. Somebody in this community gave that book.

**Circulation is not here.** A librarian may *state* that a book is borrowed,
because the shelf existed before this software did. No code path creates a loan,
sets a due date, or moves a copy between AVAILABLE and BORROWED as a side
effect. That is Phase 3, and `SELECTABLE_STATUSES` is the one line it will
change.

## 3. What Version 1 refuses to store

ISBN, publisher, publication year, series, **language**, description, tags,
keywords, ratings, reviews, price, and every donor contact detail.

Five of those were real columns in Phase 0 and are **dropped** by this
migration, not left nullable. A column nobody fills in is a field a future
screen grows back by accident. `tests/unit/catalogue.test.ts` asserts each
absence against `schema.prisma`, so re-adding one means deleting a line from a
test — a conversation rather than a commit.

The governing question, from `CATALOGUE.md`: *does this help a child find a
book, or a librarian manage the physical collection?*

## 4. Gratitude, not competition

`/donors` lists every donor once, alphabetically, in the words they chose —
named, flat only, or "a neighbour". No count, no total, no ranking, no badge.

The schema has **no counter column to hang a leaderboard on**, and a test
asserts each credit carries exactly one field: the sentence to render. Adding
"sort by generosity" would require first adding a number that deliberately does
not exist.

## 5. Two things found by doing rather than reading

**`book.view` was the wrong guard for the desk.** Every reader holds it — it is
what lets a child browse — so guarding `/admin/books` with it would have handed
any nine-year-old the librarian's list, donor names and condition notes
included. Caught while writing the authorization tests; the staff surfaces now
require `book.create`/`book.edit`/`book.archive`, and a test says so.

**A nested `<form>` broke hydration on the edit page.** The "Remove cover"
button had its own `<form>` inside the Add/Edit form. React renders that
happily on the server and then fails to hydrate the entire page in the browser —
only the console said so. The control now lives beside the cover thumbnail,
which is where it belonged anyway.

## 6. And one lock-out fixed on the way

Reaching `/login` at all turned out to be impossible with a stale session
cookie. The proxy bounced any request carrying a cookie away from `/login`, but
the proxy runs on the edge and can only see that a cookie *exists*:

```
/account  → page resolves no actor → redirect /login
/login    → cookie present         → redirect /
/         → "My library"           → /account → …
```

A child whose session had simply gone idle could not sign in again. The check
now lives on the login page, which resolves the real session — the difference
between "you are signed in" and "you have a cookie". This is an availability
fix; the authentication architecture is otherwise untouched.

## 7. Verified

`340 tests` (138 unit, 202 against real PostgreSQL), typecheck, lint, production
build (25 routes), migration-drift check and gitleaks — all clean, all actually
run.

Walked in a browser on 17 August 2026, all twenty-five steps: the librarian
signing in; Add Book showing four real `<select>` controls and **no** Language
or ISBN field and **no** Book ID field; a book saved and given its code
automatically; its cover stored at 70 bytes with every metadata chunk stripped,
`PRIVATE`, no public URL, outside `public/`; the book found by title, by partial
author and by code; edited, with the status and condition changes landing as
separate audit rows; then the child signing in and getting friendly cards, the
four filters, a detail page carrying "📚 Donated by Mrinal from P15" and no
condition, no id and no storage path; `/donors` showing all three
acknowledgement styles and no numbers; `/admin/books` and `/admin/books/new`
both redirecting the child to their own account; a cover readable by a signed-in
member and `404` — byte-identical to an unknown id — when signed out; and no
horizontal overflow at 375px.

## 8. Still open

1. **The Book ID prefix — settled.** Book copies read `MJCL-B0001`, readers'
   cards read `MJCL-R0001`: one house style, a kind letter apart. The two
   sequences are independent, so the seventh of each exists and the numbers are
   unrelated — the letter is what keeps them from being the same string. Books
   were briefly labelled `MJCL-R` too; that is corrected and the development
   copies were renamed in place. See `IDENTITY.md` §3.
2. **Donor name and flat are optional on the form.** A blank name means no
   donation record, which is right for a purchased book — but it is a choice the
   brief did not specify.
3. **A public catalogue is wired but unused.** Setting `catalogue_visibility` to
   `PUBLIC` opens the shelf and the covers to signed-out visitors. Nothing has
   exercised that path beyond its tests.
4. **`category.manage` has a permission but no screen.** Categories are
   DB-backed and reconciled by the seed; adding one still needs a seed edit.
5. **`book.delete` exists as a permission and nothing uses it.** Deliberate —
   see §8 of `CATALOGUE.md`.

And, unchanged from Phase 1.1 and still the top blocker before any real child's
data is entered: **the consent wording has not been legally reviewed**, and
**what verification strength production requires is still the owner's call**.

## 9. Not started

Phase 3. No issue, no return, no renewal, no due dates, no overdue handling, no
borrowing history. The `loan` model stays in the schema exactly as Phase 0 left
it, and nothing in Phase 2 writes to it.
