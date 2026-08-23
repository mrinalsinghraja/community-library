# Shelf labels

Stickers for the books, so a book can be found on the shelf and put back on the
right one. The book number is set large and bold; the title sits under it in a
smaller size. Two lines, nothing else.

Design reasoning is in **ADR-052**.

## Where it is

`/admin/books/labels`, reached from the **Print labels** button on the books
screen. It needs `report.view` — Librarian and Super Admin.

## How it behaves

The dates default to **the last seven days**, because the job this exists for
is a weekly one: a few books came in, they need their numbers on them. The
common case should need no typing.

- **Added from / Added up to** — both ends are included, so choosing the same
  date twice prints that one day. Dates mean days in the library's own
  timezone, not UTC.
- **Label size** — three presets, each stating how many fit a sheet and roughly
  how big one is.
- **Print cut lines** — on by default.

**Count these** reloads the page with a count and a sheet total before any
paper is spent. The download button then says exactly what it will produce:
*Print 18 labels · 1 sheet*.

Everything except the download is a plain `<form method="get">`. The settings
live in the query string, so a librarian can bookmark "last week's labels,
standard size" and come back to it every Saturday.

| Size | Per sheet | Roughly |
|---|---|---|
| Large | 14 | 93 × 39 mm |
| Standard | 24 | 62 × 34 mm |
| Small | 40 | 47 × 27 mm |

A run is capped at **1000 labels**. Beyond that, narrow the dates and print in
batches.

## Paper

**These sheets are for ordinary A4 and a pair of scissors, not for pre-cut
label stock.** Every brand places its die cuts a little differently, and a
millimetre out at the top of a page is most of a centimetre by the bottom — so
a generator that guesses at that geometry wastes a sheet of labels rather than
a sheet of paper. A printed grid you cut yourself is honest about what it is,
and a glue stick finishes the job.

Turn the cut lines off only if you are printing onto sheets that are already
cut, and check one sheet before committing a box of them.

## What it will not do

- **Archived books get no labels**, and there is no switch to include them. A
  label is for a book that is on the shelf.
- **Nothing personal is on a label** — a code and a title. No donor, no reader,
  no flat. This is the one export that can be left lying on the desk.
- **The audit log records the print, not the catalogue.** It stores how many
  labels, how many sheets, the size and the date range. Not the codes and not
  the titles: a log holding those would be a second copy of the shelf.
- **Counting is not logged.** Adjusting the dates on the screen writes nothing,
  so the log stays readable.

## Titles the printer cannot set

The PDF uses Helvetica, one of the fourteen faces every reader already has, so
nothing has to be embedded and the file stays small enough to print from a
phone. Those faces cannot draw Kannada, Devanagari or Assamese.

When a title contains characters that cannot be printed, the **book code still
prints** — it is always Latin, and it is the half that finds the book again —
along with whatever of the title survives. The sheet footer then says so
plainly, so nobody sticks a half-blank label on a book without noticing.
