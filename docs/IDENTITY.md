# Identity

Who exists in this system, how they are told apart, and what each of them can
reach.

---

## 1. Three kinds of person, three tables

| Table | Who | Signs in? |
|---|---|---|
| `app_user` | anyone who can hold a session | yes |
| `member_profile` | a child's library card: code, date of birth, flat, avatar | — |
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

### Two kinds of code, one prefix

This deployment sets `copy_code_prefix` and `member_code_prefix` to the same
value, `MJCL-R`, so that a volunteer learns one house style instead of two. The
two sequences are independent, which means the collision is not a possibility
but a certainty: **`MJCL-R0007` is both the seventh library card and the seventh
book**, and every book on the shelf carries a string that is also a valid card
number.

What that does and does not change:

- **It does not grant access.** A card code is an identifier, not a credential.
  Sign-in still requires that member's password, still throttles, and still
  answers every failure with the one generic message.
- **It does not confuse the lookup.** `member_code` and `copy_code` live in
  different tables and are only ever queried by column. `findUserByIdentifier`
  reads `member_profile` and cannot return a book; catalogue search reads
  `book_copy` and cannot return a child.
- **It does remove one obstacle for an attacker already inside the building.**
  Before, a valid card number had to be obtained from a child or a card. Now it
  can be read off any spine. Against 8-character member passwords with no
  complexity rule (ADR-013), that is a real if modest weakening: the unknown
  half of the pair is now only the password.
- **It does make desk conversation ambiguous.** "Look up MJCL-R0007" has two
  answers.

This is the owner's explicit decision, taken after the alternative (`MJCL` for
books, `MJCL-R` for cards) was in place and reviewed. Reversing it is one seed
value plus a rename of existing `copy_code` rows; nothing in the application
reads or parses the prefix.

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
