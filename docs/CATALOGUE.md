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
description · tags · keywords · ratings · reviews · reading level · purchase
price · digital editions · donor phone · donor email · donor address · any
borrower information.

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
book_title   The Jungle Book · Rudyard Kipling · Adventure & Fantasy · 8–10 years
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

Seven shelves, seeded from `DEFAULT_CATEGORIES` in `src/lib/catalogue.ts`:

**Stories · Comics · Science & Knowledge · Adventure & Fantasy ·
Activity & Learning · Young Readers · Other**

A table (`book_category`) rather than an enum, so an administrator holding
`category.manage` can add one later without a deploy. Seven, not thirty: a child
choosing a shelf and a volunteer filing a book both do better with a list they
can hold in their head.

`book_title.category_id` is **required**, with `onDelete: Restrict` — a shelf
with books on it cannot be deleted out from under them. Phase 0 seeded fourteen
categories; `npm run db:seed` retires the unused ones, and refuses to touch any
that still have books or that an administrator added by hand.

## 5. Recommended age — an enum, not a range

`5–7 years` · `8–10 years` · `11–14 years` · `All Ages`

Stored as `AgeGroup`, with the labels and the numeric bounds together in
`src/lib/catalogue.ts`. **Nothing anywhere parses "8–10 years" back into
numbers.** No free text, at any layer.

These are catalogue *shelf bands*, not the library's membership rule — that
stays in `library_settings.age_min/age_max` and answers a different question. A
nine-year-old may perfectly well borrow a book banded 11–14; the label is a
guide, and the form says so.

## 6. Condition — three words

**Good** · **Fair** · **Damaged**

Phase 0 had `NEW`, `GOOD`, `FAIR`, `WORN`. "New" is a claim nobody can verify a
year later, and "worn" and "damaged" were two words for one shelf decision.
Three values a nine-year-old volunteer can apply consistently beat five that
nobody applies the same way twice. The migration maps `NEW → GOOD` and
`WORN → DAMAGED`.

## 7. Status — and the Phase 3 boundary

| Value | Reader sees | Set by |
|---|---|---|
| `AVAILABLE` | 🟢 On the shelf | librarian, and Phase 3 |
| `BORROWED` | 📕 Someone is reading it | librarian now, **Phase 3 later** |
| `LOST` | 🔍 Missing right now | librarian |
| `DAMAGED` | ⚠️ Being mended | librarian |
| `ARCHIVED` | *not shown at all* | the archive action only |
| `RESERVED` | 🔖 Being kept for someone | **nothing in Version 1** |

**This is where the phase boundary runs.** Phase 2 lets a librarian *state*
where a book is — the shelf existed before this software did, and a book may be
in a child's bag on the day it is catalogued. Phase 2 does not *drive* that
transition: there is no issue, no return, no renewal, no due date, and no code
path in `catalogue-service.ts` creates a `loan` row.

Phase 3 owns `AVAILABLE ↔ BORROWED`. When it lands, `SELECTABLE_STATUSES` in
`src/lib/catalogue.ts` is where `BORROWED` should be removed from manual choice.

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

### What does not exist

No count. No total. No ranking. No "top donor", no "most generous family", no
badge, no score, no per-person grouping of how much anybody gave.

`/donors` lists every donor once, alphabetically, in the words they chose. A
family who gave thirty books and a family who gave one appear identically.

This is a product decision, not an unfinished feature. A leaderboard would turn
a gift into a scoreboard, and a family who cannot afford to donate would feel it
every time they opened the page. The schema has **no counter column to hang one
on**, and a test asserts that each returned credit carries exactly one field —
the sentence to render — so "sort by generosity" would require first adding a
number that deliberately does not exist.

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

`library_settings.catalogue_visibility` — **MEMBER_ONLY** for this deployment,
unchanged from Phase 0. Only signed-in members browse the shelf.

Read in exactly one place, `requireCatalogueAccess()`, so opening the catalogue
to the public later is one switch in the database rather than a hunt through
every page. `/books`, `/books/[code]` and `/donors` all pass through it, and so
does every book cover.

## 14. What a child's screen never contains

`ReaderBookCard` and `ReaderBookDetail` are **projections, not filtered
renders** — a template cannot show a field that never left the server. Neither
type has anywhere to put:

internal database ids · audit information · donor contact details ·
administrative notes · storage paths · book condition · **any information about
who has borrowed anything**.

The URL carries the code printed on the book's own label (`/books/MJCL-B0010`) —
the thing a child can read off the object in their hand — not a UUID.

**No child's name appears anywhere in this catalogue.** Verified in the browser
across the browse grid, the detail page and the donors page.
