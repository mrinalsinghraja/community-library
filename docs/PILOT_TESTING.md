# Pilot testing

The library does not open to 140 apartments on day one. It opens to a handful
of people who have agreed to be first, and who know they are.

---

## 1. Before anybody real is entered

Four of these are decisions, not tasks, and three of them are not the
developer's to make.

| | Blocker | Whose |
|---|---|---|
| 1 | **Consent wording reviewed by a competent human.** The text in `src/lib/consent.ts` has not been reviewed by a lawyer, and this software must not answer a legal question about what counts as verifiable parental consent | Owner, with legal review |
| 2 | **Required guardian verification strength chosen deliberately.** It is still `SELF_DECLARED`, the development default, which means a box was ticked | Owner, on `/admin/settings` |
| 3 | **Retention and deletion decided well enough for a pilot.** No period has been invented anywhere in this repository, and none should be | Owner |
| 4 | **A real email provider configured.** Without one, no family can finish joining — see `PRODUCTION.md` §2 | Owner |

Verified in the code, and re-verified in production during the smoke test:

- Child photographs are private, served only through an authorised route, and
  every refusal is a `404` byte-identical to an id that never existed.
- EXIF is stripped before storage; the uploader's filename never enters a path.
- Guardian phone and email sit behind `member.view_contact`.
- No analytics, no tracking pixel, no ad network, no third-party script on any
  page. `connect-src 'self'`.
- No child's name, id, photograph or loan appears in any log line. Email logs
  carry recipient and subject only — never a body, because bodies carry links.
- Reminders are off, and cannot be switched on while email is unconfigured.
- The production seed creates no people and no books; the demo seed refuses to
  run in production.

## 2. Test accounts, not children

Smoke testing happens with accounts the library creates for itself, on the real
production system, before any child is registered.

- 1 Super Admin (the owner)
- 1 Librarian
- 1 test reader, registered through the real `/join` form with a guardian
  address the owner controls

Delete nothing afterwards. Suspend the test reader instead — the audit trail of
the first real registration is worth keeping, and the software has no deletion
flow yet by design.

## 3. Smoke test

Run every line. A skipped line is an untested line.

### Authentication
- [ ] Super Admin signs in
- [ ] Librarian signs in
- [ ] Reader signs in with card number, and with username
- [ ] Sign out — the cookie no longer works on the next request
- [ ] Wrong password gives the same generic message as an unknown account
- [ ] Five wrong passwords locks the identifier for fifteen minutes
- [ ] Password reset: mail goes to the **guardian**, link works once, second use fails
- [ ] Changing a password ends every other session

### Catalogue
- [ ] Add a book with a cover
- [ ] Edit it
- [ ] Search by title and by author; `%` matches literally
- [ ] Category filter
- [ ] Donor recorded and shown on `/donors` with no borrower anywhere near it
- [ ] Archive a copy, and confirm it leaves the shelf

### Circulation
- [ ] Issue a book — due date matches the configured loan period
- [ ] Return it
- [ ] Renew at the desk
- [ ] Child requests a renewal by the code printed on the book
- [ ] Librarian approves one, refuses another; the child sees one kind sentence
- [ ] Borrow up to the limit, then be refused
- [ ] Set a due date in the past and confirm the overdue reading, then undo it

### Privacy
- [ ] A child sees only their own books
- [ ] `/desk/*` and `/admin/*` redirect a child
- [ ] Another child's photograph is `404` — identical to an id that never existed
- [ ] Another child's renewal request cannot be seen or answered
- [ ] No guardian name, phone or email appears on any reader-facing page

### Administration
- [ ] `/admin/settings` — change the loan period; an existing loan keeps its date
- [ ] `/admin/branding` — name, colour, welcome message, logo; the child-facing home page follows
- [ ] `/admin/audit` — the changes above are listed, with who made them
- [ ] A librarian is refused all three

### Email
- [ ] Only the intended test addresses receive anything
- [ ] Delivery log shows SENT, not FAILED
- [ ] `overdue_reminders_enabled` is still off

### Security
- [ ] HTTPS; HTTP redirects; certificate valid
- [ ] `curl -I` shows HSTS, `nosniff`, `X-Frame-Options: DENY`, Permissions-Policy, COOP
- [ ] CSP carries a per-request nonce and no `unsafe-inline` for scripts
- [ ] `/dev/mail` → 404
- [ ] `/api/cron/daily` → 404 without the bearer secret
- [ ] No stack trace, Prisma error text or connection string in any response
- [ ] A disabled button forced past its `disabled` attribute is still refused by the server

### Mobile
- [ ] 375 px: no horizontal page scroll on home, browse, a book, My Books, login, join
- [ ] 768 px: the same
- [ ] The desk and admin screens are usable on a phone; wide tables scroll inside their own box

## 4. The pilot itself

Two to five volunteer families. Everyone involved knows this is the first run.

Walk the real workflows, in the real order a family will meet them:

1. A guardian registers a child at `/join`
2. The librarian sees the request, checks the guardian, approves
3. The activation email arrives; the family sets a password
4. The child signs in and browses
5. The child borrows a book at the desk
6. The child asks to keep it longer
7. The librarian answers
8. The book comes back
9. A donated book is catalogued

Collect no more personal information than the software already asks for. If a
question comes up that needs another field, write it down — do not add it.

## 5. The child test

Give the system to a child of about five to fourteen with **no explanation**
and watch. Do not help. Do not narrate.

What you are looking for:

- Do they find where to browse books?
- Can they open one?
- Do they find their own books?
- Do they understand when a book is due back?
- Do they work out how to ask to keep it longer?

Every hesitation is a note about the interface, not about the child. The
interface either explains itself or it does not.

## 6. What gets fixed during the pilot

**Fix:** deployment faults, security faults, privacy faults, broken workflows,
wrong data, confusing child-facing wording, mobile layout problems, wrong
permissions, wrong circulation arithmetic.

**Do not fix by adding:** every feature suggestion goes in the backlog below and
stays there until the pilot is over. A pilot that grows the software is not a
pilot.

## 7. Backlog

Suggestions collected during the pilot. Nothing here is approved, scheduled, or
started.

| Idea | Who asked | Notes |
|---|---|---|
| _(empty — add as they come)_ | | |

Already known and deliberately deferred: reports, announcements, reservations,
holds, fines, gamification, a parent portal, WhatsApp or SMS, notification
retry, a delivery log screen, a loan detail page, guardian login, the Junior
Librarian role, and an account-deletion workflow.

## 8. Leaving the pilot

The library opens more widely when, and only when:

- the four blockers in §1 are closed,
- the smoke test passes on production,
- the pilot families completed a full borrow-and-return cycle without help,
- the child test produced no confusion the interface could not answer, and
- one backup has been taken **and restored**.
