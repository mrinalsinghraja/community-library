# Roles and who may do what

**Version 1 role model = SUPER ADMIN + LIBRARIAN + READER.** No other role is
assignable. See ADR-037 for why, and `src/lib/permissions.ts` for the list this
document describes — that file is the source of truth, and the seed reconciles
the database against it on every run.

## The three roles

| Role | Who | How they get it |
|---|---|---|
| **Super Admin** | The owner of the library. Exactly one, active. | `npm run create-admin`, run once when the library is set up. |
| **Librarian** | Operational staff at the desk. | Added by the Super Admin at `/admin/staff`. Two fields, no password, no role picker. |
| **Reader** | A child member. | Created when the Super Admin approves a registration a parent submitted. |

Two further roles exist in the database and grant nothing to anybody:
`JUNIOR_LIBRARIAN`, seeded in Phase 0 for a version that has child volunteers,
and `GUARDIAN`, which describes an adult the library writes to rather than an
account that signs in. Both are `is_assignable = false`, and `getActor` skips a
non-assignable role when it computes permissions — so a stale `user_role` row
pointing at one grants nothing.

## What a librarian can do

Everything the desk needs, and all of it reversible.

**Books** — add a book, edit its details, upload or replace or remove a cover,
change its category, age range, condition and donor acknowledgement, archive a
copy and restore it again.

**Circulation** — issue, return, renew at the desk, answer a child's request to
keep a book longer, answer a child's request to borrow one, see what is out and
what is late.

**Readers** — see the member list and the operational details a loan needs,
suspend an account and reactivate it, send a fresh activation or reset link, see
and correct guardian contact details, record a guardian verification, manage a
child's photograph.

**Registrations** — see the queue and the family's whole submission: the
child's name, age, flat and picture, the guardian's name, phone and email, when
it arrived, every consent one line at a time, and how the guardian was verified.
They can record a guardian verification. They cannot approve or reject, and the
screen says so rather than offering a button that fails: *"Waiting for Super
Admin approval."* See ADR-040.

## What a librarian cannot do

| They cannot | Because |
|---|---|
| Delete a book, a reader or anybody else | Deletion is the Super Admin's alone — `book.delete` (ADR-039) and `user.delete` (ADR-042). Everything a librarian needs in order to fix a mistake is reversible. |
| Approve or reject a registration | Whether a child joins this library is the owner's decision (ADR-037). The librarian sees the whole submission and no decision buttons (ADR-040). |
| See the evidence behind a joining decision, months later | Consent records and guardian verification on the reader detail page follow `registration.review`. The card, the flat and the guardian's phone number — what running the library needs — are theirs. |
| Close a membership (`member.deactivate`) | Ending a membership when a family leaves belongs with whoever approved it. Suspending — reversible — is theirs. |
| Create staff, promote anybody, change a role | There is no code that does any of this. `setStaffRole` does not exist. |
| Change settings, branding, consent or verification policy | Configuration is the owner's. |
| Read or delete the audit log | `audit.view` is the Super Admin's. |

None of these are enforced by hiding a button. Every service entry point calls
`requirePermission` itself, so a hand-written POST is refused exactly as a
hidden link is. Hiding the control is the courtesy; the service is the boundary.

## What a reader can do

Browse and search the catalogue, see a book's details and cover and whether it
is on the shelf, **ask to borrow a book**, see their own books and due dates,
ask to keep one longer, see their own borrowing history, and read the donor
acknowledgements.

A reader holds three permissions: `book.view`, `loan.view`, `loan.request` and
`loan.request_renewal`. None of them decides anything. The two request keys
write a row saying a child would like something; no book, copy status or due
date moves until a librarian answers.

`loan.view` means "their own books" and is scoped by ownership rather than by
the grant: the services behind a child's screens take no member id at all and
read the session. **The corollary is the trap: because every reader holds
`loan.view`, no staff screen may ever be guarded by it.** The desk's pages are
guarded by `loan.issue`, `loan.return` or `loan.renew` for exactly this reason.

## Deletion

**DELETE = SUPER ADMIN ONLY.** `DESTRUCTIVE_PERMISSIONS` in
`src/lib/permissions.ts` names them, and a test asserts no other role holds one.

There is one permanent deletion in the whole application: a book copy that
nothing has ever happened to. A copy that has been borrowed once, asked for
once, or given by anybody cannot be deleted at all — the answer is to archive
it, which keeps the record, the code and the donation. See ADR-039.

Everywhere else the account lifecycle does the work: `SUSPENDED` for a pause,
`DEACTIVATED` when a family leaves, `ARCHIVED` for a book off the shelf. History
is preserved; a reader who has left the community keeps their circulation record
so the library's account of what happened stays true.

## Staff management

`/admin/staff` is Super Admin only, guarded by `user.manage_staff`.

Adding a librarian takes two fields — name and email. There is no role dropdown,
because there is only one staff role this screen can create. **No password is
chosen by anybody**: the new librarian is emailed a single-use activation link
and chooses their own, which the Super Admin never sees. No password or token is
ever logged.

Suspending a staff account revokes every live session immediately, cancels any
outstanding activation or reset link, and writes an audit row. Reactivating puts
them back.

The last active Super Admin cannot be suspended or closed, and nobody can
suspend, close or change their own account — the two ways a community library
locks itself out of its own software.


## Permanent deletion

One permission, `user.delete`, held by the Super Admin and by nobody else. It
permits an *attempt*; almost every attempt is refused.

An account can be erased only if **nobody ever lived in it**. A reader who has
borrowed a book, asked for one, had a photograph stored, appeared in the audit
log or simply signed in once is refused; so is a librarian who has worked the
desk, answered a child, verified a guardian or signed in. The last active Super
Admin is refused outright, and nobody may delete themselves.

Everything else is closed or archived instead, and the answer is always the same
sentence:

> This account has library history and cannot be permanently deleted.
> Deactivate/archive it instead.

The two situations this exists for are the duplicate card and the invitation
sent to a mistyped address — both accounts with no history by definition.

When a reader is deleted, the family's **registration request survives**, with
its consent records and its guardian verification. The account goes; the
library's record that somebody applied, and what they agreed to, stays. Every
deletion and every refusal is audited, and the deletion's audit row is written
inside the same transaction that performs it. See ADR-042.

## The flat number

`P-15`, `A-102`, `B12`, `Tower-A-15`. Letters, digits and hyphens between them,
trimmed, twenty characters at most — enforced in the service, not only in the
form. Nothing else in the application uses this rule, and names in particular do
not. See ADR-041.
