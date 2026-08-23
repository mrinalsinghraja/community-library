# Reports and exports

Every list on the desk can be taken away as a file. This document is what the
feature does, who can use it, and what it deliberately will not do.

Design reasoning is in **ADR-045**.

## What can be exported

| Report | Screen | Who can export it |
|---|---|---|
| Books | `/admin/books` | Librarian, Super Admin |
| Readers | `/desk/members` | Librarian, Super Admin |
| Staff | `/admin/staff` | Super Admin |
| Books out | `/desk/loans` | Librarian, Super Admin |
| Books asked for | `/desk/requests` | Librarian, Super Admin |
| Asks to keep | `/desk/renewals` | Librarian, Super Admin |
| New members | `/desk/registrations` | Librarian, Super Admin |
| Audit log | `/admin/audit` | Super Admin |

Two formats: **Excel** (`.xlsx`) and **PDF**.

Shelf labels are a separate thing and live in **[LABELS.md](LABELS.md)**: a
grid of stickers rather than a table, its own route, its own writer, the same
`report.view` permission.

## How it behaves

A toolbar sits above each list with a **Select all** box, a format switch and
the download button. The button says what it will do before it does it:

- nothing ticked → *Download all 42 books* — everything the current filter
  matches, not just the page on screen
- rows ticked → *Download 3 books* — exactly those

Filters travel with the request, so exporting from a filtered screen gives the
filtered list.

**The audit log is the one exception**: it exports the page you are looking at.
It pages in SQL with no "everything" mode, and giving it one would mean an
unbounded query against the table that exists to be the record of last resort.
Narrow by date to take a wider slice.

## Who can export what, and why it is not a list here

There is no list of permissions in the export code, and this table is a
description rather than a rule. Two things have to be true:

1. **`report.view`** — may this person export at all. Held by Librarian and
   Super Admin.
2. **whatever the screen already demands** — checked by the same service the
   screen calls, not restated anywhere.

So a librarian cannot export the audit log because `listAuditEvents` asks for
`audit.view`, and cannot export the staff list because `listStaff` asks for
`user.manage_staff`. Change a role's permissions and the exports follow with no
code change. That is the point.

Columns narrow the same way. A viewer without `member.view_contact` gets a
readers export with **no guardian email or phone columns at all** — not empty
ones, because an empty column would say, untruthfully, that these families have
no email address.

## What never appears in an export

- A child's photograph, or any storage key or path
- Internal database ids
- Another library's rows
- Any donor total, ranking or leaderboard
- Anything the corresponding screen would not show the same person

The books export does carry a **Credit** column recording what each donor
agreed to, including *"asked to stay anonymous"*. On a screen the name is read
by whoever opened the page; a spreadsheet gets forwarded, and the donor's own
wish should travel with their name.

## Excel is the exact one

The spreadsheet is UTF-8 and loses nothing — a name in any script survives.

The PDF uses one of the fourteen fonts every reader already has, which are
encoded in WinAnsi and cannot draw Assamese, Devanagari or most non-Latin
scripts. Rather than crash or silently print question marks, the PDF **drops
what it cannot draw and prints a line saying so**, naming the Excel export as
the one with the exact text. If any name in the library is not written in Latin
script, use Excel.

Embedding a Unicode font would fix this at the cost of about a megabyte on
every download, plus complex-script shaping the PDF library does not do. Worth
revisiting only if it becomes a real problem for real families.

## Every export is recorded

An export writes one `report.exported` row to the audit log: which report,
which format, how many rows, whether a selection was made, and by whom.

It does **not** record which rows. A spreadsheet of children's names keeps
working after the person who took it stops being a librarian, which is why the
fact is logged — but an audit trail naming the children would be a second copy
of the thing it exists to keep track of.

A refused export writes nothing. A failed render writes nothing.

## Limits

- **5,000 rows** per export. Beyond that the request is refused with a message
  asking the person to narrow the filters. It is a guard against an unbounded
  query inside a serverless function, not a page size.
- One sheet per workbook, no formulas, no charts, no images.

## Data protection

An export is a disclosure. Under the DPDP Act a spreadsheet of children's names,
dates of birth, flat numbers and guardian contact details is personal data that
has left the system's own controls, and the library has no way to recall it.

Three things follow, and only the first two are built:

1. Only staff with `report.view` can create one, and only of lists they can
   already read.
2. Every one is logged, with who and when.
3. **There is no retention rule for the files themselves.** Once downloaded,
   what happens to that spreadsheet is a matter of library policy, not software.
   That policy does not exist yet, and it should — see the retention item in
   `docs/PRODUCTION.md`.
