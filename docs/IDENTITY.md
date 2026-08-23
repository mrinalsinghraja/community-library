# Identity

Who exists in this system, how they are told apart, and what each of them can
reach.

---

## 1. Three kinds of person, three tables

| Table | Who | Signs in? |
|---|---|---|
| `app_user` | anyone who can hold a session | yes |
| `member_profile` | a child's library card: code, year of birth, flat, avatar | — |
| `guardian` | a contactable adult | not in Version 1 |

They are separate on purpose:

- A **guardian is not a borrower.** They provide consent, receive recovery mail,
  and are contacted about their child. Giving them a login would be a second
  account to secure for no benefit anyone asked for.
- A **login identity is not library-card data.** They have different lifecycles
  and different access rules: guardian contact details sit behind
  `member.view_contact`, which most staff screens never request.

`guardian_member` joins them, so siblings share one guardian row.

## 2. How a child signs in

Children aged 5–14 mostly have no email address. Requiring one would exclude
families or push several children onto a shared parent inbox — so a member's
identity is:

- their **library card code** — `MJCL-R0042`, matching the physical card, or
- a **username** chosen at activation.

One field on the sign-in form accepts either, and staff type their email into
the same box. A child should never have to work out *which kind* of name they
have.

Lookup order in `findUserByIdentifier`: member code (case-insensitive), then
username, then email. Every failure produces one identical message.

**Internal ids are never shown.** `app_user.id` is a UUIDv7 that appears in
form fields staff submit, never in anything a child sees or a URL they visit.

## 3. Code generation

`MJCL-R0042` comes from `library_settings.member_code_prefix` +
`member_code_padding`, allocated through `code_sequence` with a single atomic
`UPDATE … RETURNING`. Concurrency-safe, never reused, never guessable-as-a-
password (it is on the blocklist for that member's own password).

See `DATABASE.md` §4 and ADR-010.

### Two kinds of code, two namespaces

A library card and a book label are different kinds of thing, and the codes say
so. One house style, two namespaces: the community's initials, a letter naming
the kind, then a padded number.

| Kind | Setting | This deployment | Example |
| --- | --- | --- | --- |
| Reader's library card | `member_code_prefix` | `MJCL-R` | `MJCL-R0007` |
| Physical book copy | `copy_code_prefix` | `MJCL-B` | `MJCL-B0007` |

The two sequences are independent and always were — `code_sequence` holds one
row per kind — so the seventh card and the seventh book both exist and both
carry the number 7. What the prefixes guarantee is that they never carry the
same *string*.

Two things worth being precise about.

**The letter is for people, not for the software.** Nothing in the application
decides what a code refers to by reading its prefix, and nothing may start.
`member_code` and `copy_code` live in different tables and are only ever queried
by column: `findUserByIdentifier` reads `member_profile` and cannot return a
book, catalogue lookup reads `book_copy` and cannot return a child. If the
prefixes were made identical again tomorrow, authorization would be exactly as
sound as it is today — which is why the guarantee is written as a table join and
not as a string test. A code is an identifier, not a credential; sign-in still
requires that member's password, still throttles, and still answers every
failure with the one generic message.

**What the separation does buy** is everything a human does with a code. A book
on the shelf no longer displays a string that is also a valid card number, so
the card half of a sign-in attempt cannot be read off a spine by someone already
in the room. Against 8-character member passwords with no complexity rule
(ADR-013), that matters more than it looks. And "look up MJCL-B0007" now has one
answer instead of two.

**History.** Books were briefly labelled `MJCL-R` as well, matching the cards.
That is corrected: the development copies were renamed in place, readers were
untouched, and the old string no longer resolves to a book. Audit rows written
before the rename still quote the old label in their metadata — they are a
record of what happened, and they link to the copy by id, so a book's history
survives the rename regardless of the label in the snapshot.

This is not a Mana Jardin special case. The platform defaults are `LIB-B` and
`LIB-R`, so a community that configures nothing still gets two namespaces that
cannot spell each other. Migration
`20260817180000_book_code_default_namespace` changed that default and nothing
else — column defaults apply to future inserts, so no existing settings row and
no printed code moved.

## 4. Roles

Five roles, seeded per library, each a row:

| Role | Who | Notes |
|---|---|---|
| `SUPER_ADMIN` | the library's owner | every permission; the last active one cannot be removed |
| `LIBRARIAN` | volunteers running the desk | registrations, readers, books, circulation |
| `JUNIOR_LIBRARIAN` | a child volunteer | **seeded, not assignable** — see §5 |
| `MEMBER` | a child | `book.view` only; everything else is ownership-scoped |
| `GUARDIAN` | a parent | no permissions in Version 1 |

Permissions are read from the database on every request, so a role change takes
effect on the actor's very next request with no session churn. Verified by test.

## 5. The Junior Librarian, and why it is not switched on

The role exists in `src/lib/permissions.ts` with `isAssignable: false`. It maps
to exactly four permissions: `book.view`, `loan.issue`, `loan.return`,
`member.view`.

`PERMISSIONS_FORBIDDEN_FOR_CHILD_STAFF` lists what it must never hold —
guardian contact details, password actions, member creation, suspension,
deactivation, deletion, settings, roles, audit, private donor data — and a unit
test asserts the intersection is empty. That test is the guard against a future
edit quietly widening a role held by a twelve-year-old.

`getActor()` additionally skips any role with `isAssignable: false` when
computing permissions, so even a hand-inserted `user_role` row grants nothing.
Verified by test.

## 6. Account statuses

The Phase 1 brief listed nine statuses. Several of them describe a
*registration*, not an account, and the two already had separate state machines —
so nothing was duplicated. The mapping:

| Brief's status | Where it lives |
|---|---|
| PENDING, UNDER_REVIEW, APPROVED, REJECTED | `registration_request.status` |
| ACTIVATION_PENDING | `app_user.status = INVITED` — approved, no password yet |
| ACTIVE, SUSPENDED, DEACTIVATED, ARCHIVED | `app_user.status` |

`INVITED` is the name Phase 0 gave to "approved, activation link sent, password
not yet chosen". Adding a second identically-meaning value would have created
two sources of truth for one fact.

Full transitions: `ACCOUNT_LIFECYCLE.md`.

## 7. What each person can see about others

| Viewer | Can see |
|---|---|
| Member | their own profile and account. Nothing about any other member, ever |
| Guardian | (no login in v1) |
| Junior Librarian *(future)* | member names and cards. No contact details |
| Librarian | members, guardians' contact details, registrations |
| Super Admin | the above plus staff, settings and the audit log |

Enforced in services, not templates. `listMembers()` strips guardian email and
phone at the service boundary when the actor lacks `member.view_contact`, so a
component that forgets to check still renders nothing — verified by test.
