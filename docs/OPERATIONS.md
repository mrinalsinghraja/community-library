# Operations

The runbook. Written for whoever is holding the library on a Saturday morning,
which may not be the person who built it.

---

## Daily job

Vercel Cron calls `GET /api/cron/daily` at 03:00 UTC (08:30 Asia/Kolkata),
authenticated with `CRON_SECRET`.

It currently does housekeeping only: deletes expired sessions, spent activation
and reset tokens, and login-attempt rows older than 30 days. Overdue reminders
join it in a later phase.

**If it fails to run, nothing breaks.** Overdue status is derived from
`due_at < now()` at read time, never stored, so a missed run leaves a few dead
rows and nothing else.

Check it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://library.msrx.co.in/api/cron/daily
```

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

### "Which books did the Phase 3 upgrade put back on the shelf?"

Migration 6 reset any copy that read `BORROWED` with no loan — a status set by
hand before circulation existed, with nobody attached to it. It invented no
borrower, and it named every book it touched:

```sql
SELECT occurred_at,
       metadata->>'copyCode' AS book,
       metadata->>'reason'   AS why
  FROM audit_log
 WHERE actor_label = 'System (Phase 3 reconciliation)'
 ORDER BY occurred_at;
```

Each of those is a shelf worth checking: the library does not know where the
book is, only that no loan ever recorded it leaving.

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
vercel env pull .env.production.local
npx dotenv -e .env.production.local -- npx prisma migrate deploy
rm .env.production.local
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
