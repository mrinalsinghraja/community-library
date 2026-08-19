# Operations

The runbook. Written for whoever is holding the library on a Saturday morning,
which may not be the person who built it.

Going live for the first time is a different document:
[`PRODUCTION.md`](PRODUCTION.md), and then [`PILOT_TESTING.md`](PILOT_TESTING.md).

---

## Daily job

Vercel Cron calls `GET /api/cron/daily` at 03:00 UTC (08:30 Asia/Kolkata),
authenticated with `CRON_SECRET`.

**Housekeeping**, first: expired sessions, spent activation and reset tokens,
login-attempt rows older than 30 days, lapsed verification challenges, and the
media sweep.

**Then reminders**, since Phase 4: due-soon and overdue notes to guardians, if
`overdue_reminders_enabled` is on. **It is off in this deployment and stays
off** — see ADR-032 for the four conditions that must be met before it is turned
on. With it off the pass claims nothing, sends nothing, and reports
`"reminders": { "enabled": false, … }`. They run last and inside a `try` that cannot
fail the rest — a mail server having a bad morning must not stop the library's
own housekeeping. The response says what was sent:

```json
"reminders": { "enabled": true, "due": 3, "sent": 2,
               "failed": 0, "alreadySent": 1, "noRecipient": 0 }
```

`alreadySent` is normal and not a warning: it means the job already covered
those occurrences, which is exactly what the duplicate guard is for. **Running
this endpoint twice is safe**, including at the same instant — see
`docs/NOTIFICATIONS.md`.

**If it fails to run, nothing breaks.** Overdue status is derived from
`due_at < now()` at read time, never stored, so a missed run leaves a few dead
rows and one morning's reminders unsent. Those occurrences are not caught up
retroactively; the next configured offset comes round.

Check it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://library.msrx.co.in/api/cron/daily
```

## Changing how the library works

Since Phase 5 a Super Admin does this on a screen, not in `psql`:

| What | Where |
|---|---|
| Loan period, book limit, renewals, ages, prefixes, timezone, catalogue visibility | `/admin/settings` |
| Required guardian verification strength | `/admin/settings`, behind a confirmation |
| The reminder switch | `/admin/settings` — **refused while `EMAIL_PROVIDER=console`** |
| Name, colour, welcome message, rules text, contact details, logo | `/admin/branding` |
| Who changed what, and when | `/admin/audit` |

Two things to know before you touch any of it:

* **A setting decides the future.** Changing the loan period does not move a due
  date a child has already been told, and changing a code prefix does not
  renumber a card or a label. Only the next issue, the next renewal and the next
  code use the new value.
* **Consent wording is not editable there.** It lives in the code and changes
  with a release, so that no consent record can end up describing wording nobody
  saw (ADR-033).

Full reference: [`SETTINGS.md`](SETTINGS.md).

## Backups — required

Neon's free tier gives a **6-hour** point-in-time restore window. That is not a
backup strategy for a library's records.

```bash
pg_dump "$DIRECT_URL" --format=custom --file="library-$(date +%F).dump"
```

Do this on a schedule you actually keep. Store dumps somewhere the Vercel and
Neon accounts do not control — if one account is lost, the backups must not go
with it.

**Test a restore at least once:**

```bash
createdb library_restore_test
pg_restore --dbname=library_restore_test --clean --if-exists library-2026-08-17.dump
```

An untested backup is a hope, not a backup.

## Health

```bash
curl https://library.msrx.co.in/api/health      # {"status":"ok"}
```

Returns 503 when the database is unreachable. Point a free uptime monitor at it;
this also keeps the Neon compute warm enough to avoid a cold start on the first
real visitor of the day.

## Common situations

### "A child cannot sign in"

1. Is the account `ACTIVE`? A suspended or not-yet-activated account gives the
   same generic message as a wrong password, by design.
2. Have they been locked out? Five failures locks an identifier for 15 minutes.
   It clears itself — no action needed.
3. Genuinely forgotten? Send a fresh activation link from the desk. **Nobody at
   the library can see or set a password**, so this is the only route.

### "Someone must be locked out right now"

Suspend the account. Their live sessions end on their very next request:

```sql
UPDATE app_user SET status = 'SUSPENDED' WHERE id = '…';
```

The application deletes their session rows on the next resolution. To be
immediate and explicit:

```sql
DELETE FROM "session" WHERE user_id = '…';
```

### "The site is slow on the first visit of the day"

Neon scale-to-zero. The compute suspends after 5 minutes idle and resumes on the
next connection. A uptime ping every few minutes hides it.

### "A book shows as borrowed but it is on the shelf"

Look at the loan and its events — the history is append-only, so the story is
intact:

```sql
SELECT l.*, c.copy_code FROM loan l
  JOIN book_copy c ON c.id = l.copy_id
 WHERE c.copy_code = 'MJCL-B0042' ORDER BY l.issued_at DESC;

SELECT * FROM loan_event WHERE loan_id = '…' ORDER BY occurred_at;
```

**Return it through the desk, at `/desk/loans`.** Do not edit rows: the database
will refuse you anyway. A deferred constraint trigger enforces that a copy reads
`BORROWED` if and only if it has exactly one `ACTIVE` loan, so setting the status
by hand fails with

```
ERROR: Book MJCL-B0042 is on loan but reads AVAILABLE;
       a book somebody has must read BORROWED
```

If the book genuinely should never have gone out — wrong child, wrong book —
use **"Issued by mistake"** on the loan row. That needs `loan.correct`, asks for
a reason, and leaves the loan, its events and an audit row behind it. Nothing is
deleted.

### An inconsistent circulation state

**The situation.** A copy reads `BORROWED` and has no active loan behind it, so
the record says the book is out and cannot say who has it. This happens to a
library upgrading from Phase 2, where a librarian could type that status by
hand, before loans existed to back it up.

**What the upgrade does about it: nothing, deliberately.** Migration 6 stops
before it changes anything:

```
ERROR: Cannot enable circulation: 1 book(s) read BORROWED with no loan and so
       no borrower (MJCL-B0010). Someone must find out where each one is;
       a deployment must not guess.
```

That is not a bug to work around. Every automatic repair is a claim the
deployment cannot support. Marking the book `AVAILABLE` tells the next child it
is on the shelf, when it may be in another child's bag. Writing a loan puts a
name against it that nothing in the database knows, and that name would sit in a
real child's borrowing history from then on. **A deployment must never make a
physically borrowed book appear available, and must never invent a borrower.**

**What to do.** List them — this changes nothing:

```bash
npm run reconcile:circulation
```

Then, for each book, find out where it actually is. Ask at the desk, look on the
shelf, check the returns trolley. There are three answers and each has a
command. All three record your name and your reason in the audit log.

**It is on the shelf.**

```bash
npm run reconcile:circulation -- --copy MJCL-B0010 --on-shelf \
  --operator "Priya" --reason "Found on the returns trolley"
```

**A child has it, and you know which child.** Give their card number and the
real dates — the loan appears in that child's history, so it should say what
happened rather than what was convenient. The book stays `BORROWED`, which is
now true.

```bash
npm run reconcile:circulation -- --copy MJCL-B0010 --with MJCL-R0007 \
  --issued 2026-08-01 --due 2026-08-15 \
  --operator "Priya" --reason "Aarav's family confirmed they have it at home"
```

Only use this when you are sure. A wrong card number puts a book in the wrong
child's history, and the history is not editable afterwards.

**Nobody knows where it is.**

```bash
npm run reconcile:circulation -- --copy MJCL-B0010 --missing \
  --operator "Priya" --reason "Not on the shelf, nobody recalls lending it"
```

This marks the copy `LOST`, which is the honest answer: the library does not
have it, does not know who does, and will not offer it to the next child who
asks. If it turns up, a librarian restores it through the catalogue.

**Then run the migration again.** It re-checks and continues. You can also
confirm you are finished at any point:

```sql
SELECT circulation_assert_no_stranded_copies();
```

Silence means every borrowed book has a borrower. The function is installed by
migration 6 and stays available afterwards, so this is also the check to run if
you ever suspect the two have drifted apart.

**What you decided is recoverable.** Every resolution writes an audit row under
your name:

```sql
SELECT occurred_at, actor_label,
       metadata->>'copyCode' AS book,
       metadata->>'to'       AS became,
       metadata->>'reason'   AS why
  FROM audit_log
 WHERE metadata->>'via' = 'reconcile-circulation'
 ORDER BY occurred_at;
```

### "Who has this book out, and how late is it?"

```sql
SELECT c.copy_code, t.title, u.display_name AS reader,
       l.issued_at::date, l.due_at::date,
       greatest(0, (current_date - l.due_at::date)) AS days_over
  FROM loan l
  JOIN book_copy c ON c.id = l.copy_id
  JOIN book_title t ON t.id = c.title_id
  JOIN app_user u ON u.id = l.member_user_id
 WHERE l.status = 'ACTIVE'
 ORDER BY l.due_at;
```

The desk's **Late** filter at `/desk/loans?filter=overdue` runs the same
comparison. There is no overdue column to consult and none to repair — the
answer is computed when you ask, so it cannot be stale.

### "Did the reminder actually go out?"

```sql
SELECT n.claimed_at, n.kind, n.offset_days, n.status,
       c.copy_code, u.display_name AS reader,
       e.recipient, e.error
  FROM loan_notification n
  JOIN loan l ON l.id = n.loan_id
  JOIN book_copy c ON c.id = l.copy_id
  JOIN app_user u ON u.id = l.member_user_id
  LEFT JOIN email_event e ON e.id = n.email_event_id
 ORDER BY n.claimed_at DESC LIMIT 50;
```

`SENT` means a provider accepted it. `FAILED` means it did not, and `e.error`
says why — **that occurrence is not retried**, by design (ADR-029); the next
configured offset is the next chance. `QUEUED` on an old row means the job died
between claiming and sending, which is rare and worth mentioning if you see it
more than once.

Nothing here is the source of truth for anything. Deleting every row in this
table would cause the next run to re-send reminders, and would change nothing
about any book.

### "More than one pending renewal request"

**The situation.** Migration 7 refuses to build
`renewal_request_one_pending_per_loan` because a loan already holds two open
requests. It names the loans and stops; it does not pick one to delete.

This should be unreachable — the table was unused before Phase 4 — but the
principle is the same as migration 6's (ADR-027): a child asked twice, and which
of those asks stands is not a deployment's decision.

**What to do.** Look at them, and cancel the ones that should not stand, as a
person, with your own hands:

```sql
SELECT r.id, r.requested_at, c.copy_code, u.display_name
  FROM renewal_request r
  JOIN loan l ON l.id = r.loan_id
  JOIN book_copy c ON c.id = l.copy_id
  JOIN app_user u ON u.id = l.member_user_id
 WHERE r.status = 'PENDING'
 ORDER BY r.requested_at;

-- Keep the earliest; withdraw the rest.
UPDATE renewal_request SET status = 'CANCELLED', decided_at = now()
 WHERE id = '<the-later-one>';
```

Then tell Prisma the failed attempt is over, and re-run:

```bash
npx prisma migrate resolve --rolled-back 20260817220000_phase4_notifications_and_renewal_requests
npx prisma migrate deploy
```

**The `resolve --rolled-back` step is required and easy to miss.** A migration
that fails is recorded as failed, and `migrate deploy` refuses to do anything at
all until that record is cleared — including migrations that have nothing to do
with it. This is safe here precisely because the guard runs first and the
migration is all-or-nothing: nothing was applied, so there is nothing to undo
before saying so. The same applies to migration 6's stranded-copy guard.

### "Something is wrong and I need to know who did what"

```sql
SELECT occurred_at, actor_label, action, entity_type, entity_id
  FROM audit_log ORDER BY occurred_at DESC LIMIT 100;
```

The log never contains passwords, tokens or secrets — a redactor strips anything
resembling a credential before it is written.

## Deploying a change

```bash
npm run verify && npm run test:db     # never skip
git push                              # Vercel builds from main
```

Migrations are **not** run by the build. Apply them deliberately:

```bash
vercel env pull .env.vercel-production
npx dotenv -e .env.vercel-production -- npx prisma migrate deploy
rm .env.vercel-production
```

## Rolling back

- **Code:** Vercel → Deployments → promote the previous deployment. Instant.
- **Database:** migrations are additive by policy. A destructive change ships
  only as add → backfill → switch → remove-in-a-later-release.

## Rotating secrets

| Secret | Effect of rotating |
|---|---|
| `AUTH_SECRET` | Everyone is signed out; pending activation and reset links stop working; hashed-IP correlation resets |
| `CRON_SECRET` | Update it in Vercel; the next scheduled run uses the new value |
| Database password | Rotate in Neon, update both `DATABASE_URL` and `DIRECT_URL`, redeploy |

## Handover checklist

Before the person who set this up stops being the person who runs it:

- [ ] A second Super Admin account exists
- [ ] Someone else can access the Vercel, Neon and GitHub accounts
- [ ] Someone else knows where the backups are and has restored one
- [ ] `docs/` has been read by whoever is taking over
- [ ] The librarian guides are printed and by the shelf
