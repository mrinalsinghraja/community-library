# The Catalogue

Two audiences, one shelf: a librarian who may well be twelve years old, adding a
book in about a minute; and a child looking for something to read.

**The question that governs every addition to this catalogue:**

> Does this directly help a child find a book, or help a librarian manage the
> physical collection?

If not, it does not belong in Version 1. Most of this document is about what is
not here.

---

## 1. The ten fields

| # | Field | Control | Required | Belongs to |
|---|---|---|---|---|
| 1 | Book ID | *generated* | — | copy |
| 2 | Book title | text | ✅ | title |
| 3 | Author | text | ✅ | title |
| 4 | Category | dropdown (DB-backed) | ✅ | title |
| 5 | Recommended age | dropdown (enum) | ✅ | title |
| 6 | Cover image | file | — | title |
| 7 | Donated by | text | — | copy |
| 8 | Donor flat no. | text | — | copy |
| 9 | Donation date | date picker | — (defaults today) | copy |
| 10 | Condition | dropdown (enum) | ✅ | copy |
| 11 | Status | dropdown (enum) | ✅ | copy |

Four dropdowns, three text boxes, one date, one optional file. Three fields
arrive already answered — **Good**, **Available**, **today** — because those are
right most of the time.

**The Book ID is not on the form.** It is allocated by the database inside the
same transaction that creates the book, so two people cataloguing at the same
desk cannot be handed the same number and nobody has to remember where the
numbering got to.

Books are labelled `MJCL-B0001`, readers' cards `MJCL-R0001` — the same house
style with a letter naming the kind. The two sequences are independent, so
`MJCL-B0007` and `MJCL-R0007` both exist and are unrelated numbers; the letter is
what stops them being the same string. Nothing in the application works out what
a code refers to by reading the letter (see `IDENTITY.md` §3 and ADR-023).

## 2. What is deliberately not here

ISBN · publisher · publication year · series · volume · **language** ·
description · tags · keywords · reading level · purchase price · digital
editions · donor phone · donor email · donor address · any borrower information.

**Ratings arrived in ADR-057 and are not on this list any more** — and since
ADR-058 nothing reaches a book's page until a Librarian or the Super Admin
approves it, publication is permanent, and only the Super Admin can delete a
published review. But the rating *column* is still on this list. `book_title` holds no rating, no average and no count; it
holds a relation to `book_review`, and every average in the application is
derived at read time from the reviews that are currently visible. A cached
number would have to be recomputed on every write and would drift the first time
a librarian hid a review.

These are removed from the schema, not merely hidden. Phase 0 had `language`,
`publisher`, `isbn13`, `isbn10` and `description` columns on `book_title`;
migration `20260817160000_phase2_catalogue` drops all five.

**Why drop rather than leave nullable:** a column nobody fills in is a field a
future screen grows back by accident, and "it was already there" is how a
one-minute form becomes a fifteen-field one. Re-adding any of them now costs a
migration and a decision, which is the right price. `tests/unit/catalogue.test.ts`
asserts each one's absence against the schema file, so adding one requires
deleting a line from a test — a conversation rather than a commit.

**Language, specifically.** Version 1 assumes the collection is English. There
is no language input, no dropdown, no filter and no column. Multilingual support
is a real future decision, and pre-building half of it would shape the UI around
a choice nobody has made.

## 3. Title and copy stay separate

```
book_title   The Jungle Book · Rudyard Kipling · Adventure & Fantasy · 8–11 years
  └─ book_copy  MJCL-B0010  Good      Available   donated by Mrinal, P15
  └─ book_copy  MJCL-B0028  Fair      Borrowed    donated by the Iyer family
  └─ book_copy  MJCL-B0047  Good      Available   (bought)
```

One thing that can be *described*, three things that can be *borrowed*. Every
physical copy has its own permanent code, condition, status and donation.

**Adding a book reuses an existing title when the title and author both match,
case-insensitively.** So cataloguing a second Jungle Book creates a second copy,
not a second record — and the result message says which happened. A different
author with the same title is treated as a different book, because two books can
share a name and a silent merge would attach a copy to the wrong one.

When a title is reused, its category, reading age and cover are **left alone**.
The bibliographic record belongs to the book, not to whoever catalogued the
newest copy. The edit screen says this out loud, because it surprises people:
changing the title, author, shelf, age or cover changes every copy.

## 4. Categories — rows, not an enum

Five shelves, seeded from `DEFAULT_CATEGORIES` in `src/lib/catalogue.ts`:

**Stories · Comics · Science & Knowledge · Activity & Learning · Other**

"Adventure & Fantasy" and "Young Readers" were among the original seven and
were retired in August 2026, empty: adventure and fantasy is what Stories
already holds, and "Young Readers" named an age rather than a subject, which
the reading age beside it already says.

A table (`book_category`) rather than an enum, so an administrator holding
`category.manage` can add one later without a deploy. Five, not thirty: a child
choosing a shelf and a volunteer filing a book both do better with a list they
can hold in their head.

`book_title.category_id` is **required**, with `onDelete: Restrict` — a shelf
with books on it cannot be deleted out from under them. Phase 0 seeded fourteen
categories; `npm run db:seed` retires the unused ones, and refuses to touch any
that still have books or that an administrator added by hand.

## 5. Recommended age — an enum, not a range

`5–7 years` · `8–11 years` · `12–16 years` · `All Ages`

Stored as `AgeGroup`, with the labels and the numeric bounds together in
`src/lib/catalogue.ts`. **Nothing anywhere parses "8–11 years" back into
numbers.** No free text, at any layer.

These are catalogue *shelf bands*, not the library's membership rule — that
stays in `library_settings.age_min/age_max` and answers a different question. A
nine-year-old may perfectly well borrow a book banded 12–16; the label is a
guide, and the form says so.

## 6. Condition — three words

**Good** · **Fair** · **Damaged**

Phase 0 had `NEW`, `GOOD`, `FAIR`, `WORN`. "New" is a claim nobody can verify a
year later, and "worn" and "damaged" were two words for one shelf decision.
Three values a nine-year-old volunteer can apply consistently beat five that
nobody applies the same way twice. The migration maps `NEW → GOOD` and
`WORN → DAMAGED`.

## 7. Status — and the line circulation owns

| Value | Reader sees | Set by |
|---|---|---|
| `AVAILABLE` | 🟢 On the shelf | librarian, and circulation on return |
| `BORROWED` | 📕 Someone is reading it | **circulation only** |
| `LOST` | 🔍 Missing right now | librarian |
| `DAMAGED` | ⚠️ Being mended | librarian, and circulation on a damaged return |
| `ARCHIVED` | *not shown at all* | the archive action only |
| `RESERVED` | 🔖 Being kept for someone | **nothing in Version 1** |

**This is where the boundary runs.** A librarian *states* where a book is when
it is not out — the shelf existed before this software did. Circulation *drives*
`AVAILABLE ↔ BORROWED`, and as of Phase 3 it owns that transition outright.

`BORROWED` was removed from `SELECTABLE_STATUSES` when Phase 3 landed. A copy
reads BORROWED because a loan says so and for no other reason, and a deferred
constraint trigger refuses to commit any other arrangement (ADR-024). A dropdown
that could set it would be a borrowed book with no borrower.

Consequences for the edit form and the service:

* the form for a book that is out renders a read-only note and **no status
  control at all** — there is nothing valid for it to offer;
* `status` is therefore optional in the input schema, and an omitted one means
  "leave it as it is";
* `updateBook` refuses a status change while a loan is active, with a sentence
  about the desk rather than a Postgres exception — while still allowing every
  bibliographic edit, because correcting a title should not require the book
  back;
* `archiveBook` refuses a copy that is out. A book cannot leave the collection
  while a child has it.

`ARCHIVED` is absent from the dropdown deliberately: archiving is its own
audited action with its own reason, not a value somebody can pick by mistake.

## 8. Archive, never delete

There is no delete button anywhere in this catalogue, and no service function
that removes a book.

- physically lost → `LOST`
- beyond mending → `DAMAGED`
- permanently gone from the shelf → `ARCHIVED`, with `archived_at` and a reason

An archived copy keeps its code, its donation, its condition and every audit row
that mentions it. It vanishes from the reader's catalogue entirely and from the
staff list until "include archived" is ticked. `restoreBook` puts it back,
because "archived by mistake" happens at a busy desk.

A database CHECK requires `status = 'ARCHIVED'` and `archived_at IS NOT NULL` to
agree **in both directions**, so neither half can drift.

Somebody in this community gave that book. Erasing the record would erase the
gift with it.

## 9. Donations — gratitude, not competition

The catalogue records exactly three things: **donor name**, **flat number**,
**donation date**. No phone, no email, no address, no identity document. A name
and a flat number are enough to say thank you.

**Donation is voluntary, including on this form.** A blank donor name means no
donation record — the right answer for a book the library bought. Nothing about
membership, borrowing, or anything else, ever depends on a donation existing.

### The acknowledgement

`donorAcknowledgement()` is the only place `display_consent` is read, so there
is one answer to "what may we say about this donation?" rather than one per
template:

| Donor chose | Rendered |
|---|---|
| `NAMED` | 📚 Donated by Mrinal from P15 |
| `APARTMENT_ONLY` | 📚 Donated by a family in P15 |
| `ANONYMOUS` | 📚 Donated by a neighbour |

It appears on the book's own page, where there is room to say thank you
properly — **not** on every browse card, which would stamp a name on every tile.
`ReaderBookCard` has no donor field at all, so no template change can put one
there by accident.

### The register

`/donors` is a register, and it is **open to visitors who have not signed in** —
the only reader-facing page that is. It is read by `listDonorRegister()` in
`src/server/services/donor-service.ts`, which never passes through
`requireCatalogueAccess()`, and it lists every family once, alphabetically, with
the flat they gave from, **the year they gave**, and how many books. Each name
links to `/donors/[donor]`, that family's own page, showing the books as a
shelf: cover, title, author and the month the book arrived.

The year is there because **flats are rented**. The same flat number five years
apart is usually a different household, and a register without a year reads
those two families as one entry that grew. It is taken from the library's
timezone, not the server's.

That page prints **no copy code, no shelf, no reading age, no condition and no
borrower**, and a title becomes a link into the catalogue only for a visitor who
could already open it. A thank-you is not a second way to read the shelf.

The jackets are the one amendment to the cover gate (ADR-021, amended by
ADR-046): a signed-out request may read a cover **whose title carries a credited
donation**, because that jacket is on the public donor page beside a title and
author already printed there. A bought book's cover stays refused, and so does
an anonymous family's.

The family is addressed by `sha256(libraryId | consent | name | flat)`, first
sixteen characters — never a readable slug. The page shows a name because the
family agreed to that; a URL is copied, logged and kept, and was not part of the
agreement. Nothing stores the id, so a family who later asks to be anonymous
breaks the link they were given, which is correct.

### What still does not exist

No total. No ranking. No "top donor", no "most generous family", no badge, no
score, no bar.

The count arrived in ADR-046 because the owner asked for it. Alphabetical order
is now the only thing between a register and a league table, so the sorting is
done in the service, the type carries no other key to sort by, and the cell
reads "3 books" rather than a bare "3" — a number without its unit, right
aligned down a column, is a chart with the bars taken off. The schema still has
no counter column, and the count is derived per request from the rows
themselves.

And `displayConsent` still decides every line. A family who asked for the flat
alone is named by their flat and their name never leaves the service; a family
who asked to stay out of it has no row, no id and no page, and is thanked in one
closing line that counts *families* rather than books.

### How the choice is recorded

The book-intake form asks the librarian one question — **"Do not publish this
name"**, a checkbox, unticked. Publishing is the default: asking every family to
opt in would leave the thank-you page empty, so the wording at the desk says the
name goes on a public page unless somebody asks otherwise. The name is stored
either way, so the librarian always knows who gave the book.

**Unticked does not mean "reset to the library default".** It keeps whatever
non-anonymous choice is already recorded, so a librarian opening the form to fix
a spelling cannot republish a name a family asked to keep off — `APARTMENT_ONLY`
survives a save it was not part of. Unticking an anonymous donation is the one
way a name comes back.

## 10. Cover pictures

Same pipeline as a child's photograph — magic-byte sniffing, executable
refusal, 5 MB cap, generated opaque key, EXIF stripped, unclaimed-upload
deadline, ledger-and-follow deletion. See [`MEDIA.md`](MEDIA.md).

**Stored `PRIVATE`, and that needs explaining**, because a book jacket is
obviously not sensitive. `PRIVATE` here means exactly one thing: *no public URL
is ever minted*. The catalogue defaults to MEMBER_ONLY, and a CDN link would be
a way around the front door that no permission check could close afterwards.

The **authorization rule** is nevertheless completely different from a child's
photograph, and written out as its own branch in `getAuthorizedMedia` so that a
change meant for covers cannot loosen what applies to a child:

| | Book cover | Child photograph |
|---|---|---|
| Any signed-in member | ✅ | ❌ |
| The child themselves | ✅ | ✅ |
| Staff with `member.view` | ✅ | ✅ |
| Signed-out visitor | only if catalogue is `PUBLIC` | ❌ ever |

`claimUnclaimedBookCover` is scoped by purpose, so posting a book form carrying
a *child photograph's* media id fails: the id simply does not resolve. There is
a test for exactly that.

Books with no cover get a **drawn** one — a spine, page edges, and the book's
own title, tinted from a hash of that title so the same book always looks the
same. That is the normal case, not an error state: this shelf is stocked by
families, not by a supplier with a metadata feed. There is no `<img>` at all
when there is no cover, so there is no broken-image icon to render.

## 11. Search and filtering

Search covers **title, author and Book ID** — case-insensitive, partial, so
"jungle" finds The Jungle Book and "kipl" finds Kipling.

Donor fields are **not searchable**. A donor's name is a thank-you, not a search
key, and nobody should be able to enumerate the catalogue by who lives where.

| Filter | Reader | Staff |
|---|---|---|
| Shelf | ✅ | ✅ |
| Recommended age | ✅ | ✅ |
| Condition | — | ✅ |
| Status | — | ✅ |
| Include archived | never | ✅ |
| Sort | newest | newest / title / author / Book ID |

All of it runs in PostgreSQL, driven by the query string. That buys three things
at once: the browser is never handed the whole catalogue to sort, the filter
forms work with JavaScript switched off, and a librarian can bookmark or send
"all the damaged comics".

Sort is chosen from a fixed map — `Prisma.raw` escapes nothing, so the only safe
input to it is one the user could not have supplied. `%` and `_` in a search
term are escaped, or a child typing "50%" would match the whole library.

Indexes: full-text over title+authors, trigram over `lower(title)` and over
`book_title_authors_text(authors)`, `lower(copy_code)`, and a partial index on
non-archived copies. All expression-based — which is also what stops
`prisma migrate dev` quietly dropping them.

## 12. Permissions

| | Super Admin | Librarian | Junior Librarian | Reader |
|---|---|---|---|---|
| `book.view` — browse | ✅ | ✅ | ✅ | ✅ |
| `book.create` | ✅ | ✅ | — | — |
| `book.edit` | ✅ | ✅ | — | — |
| `book.archive` | ✅ | ✅ | — | — |
| `category.manage` | ✅ | ✅ | — | — |
| `donation.view_private` | ✅ | ✅ | ❌ forbidden | — |
| `book.delete` | ✅ *(nothing uses it)* | — | ❌ forbidden | — |

⚠️ **The staff screens are guarded by `book.create`/`book.edit`/`book.archive`,
never by `book.view`.** Every reader holds `book.view` — that is what lets a
child browse — so guarding the desk with it would hand any nine-year-old the
librarian's book list, donor names and condition notes included. This was caught
while writing the authorization tests, and there is now a test for it.

Junior Librarian remains seeded and unassignable. `category.manage` is
deliberately *not* in `PERMISSIONS_FORBIDDEN_FOR_CHILD_STAFF`, so a future
decision can grant selected catalogue permissions to a child volunteer without a
code change — which is the whole point of roles being rows.

## 13. Visibility

`library_settings.catalogue_visibility` — **PUBLIC** for this deployment as of
ADR-057, at the owner's request. Anybody may search the shelf, read a book's
page and read what other readers thought of it, with no account. Nobody borrows
without a library card: a signed-out visitor gets a sentence saying so and a way
in, never a disabled button.

Read in exactly one place, `requireCatalogueAccess()`, so opening the catalogue
to the public later is one switch in the database rather than a hunt through
every page. `/books` and `/books/[code]` pass through it, and so does every book
cover.

`/donors` deliberately does not — see ADR-046. It is served by its own service
and is readable signed out whatever this setting says, which is why the family
pages it links to print no covers and no catalogue detail.

## 14. What a child's screen never contains

`ReaderBookCard` and `ReaderBookDetail` are **projections, not filtered
renders** — a template cannot show a field that never left the server. Neither
type has anywhere to put:

internal database ids · audit information · donor contact details ·
administrative notes · storage paths · book condition · **any information about
who has borrowed anything**.

The URL carries the code printed on the book's own label (`/books/MJCL-B0010`) —
the thing a child can read off the object in their hand — not a UUID.

**No child's name appears anywhere in this catalogue except on a review they
chose to sign and a guardian approved** — and then only a first name, never
more. See ADR-057: the
choice is asked per review rather than per account, `publicByline` is the single
function that can emit it, and the alternative it returns is "A reader at the
library". Nothing anywhere connects a name to a *borrowing*: who has a book out
and who had it last remain invisible, as they always were.

Verified in the browser across the browse grid, the detail page, a book's
reviews and the donors page.
