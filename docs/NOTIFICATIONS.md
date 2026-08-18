# Notifications

What the library says to a family about a book, when it says it, and the
machinery that stops it saying the same thing twice.

Phase 4. Before it, nothing was sent at all.

> ## Reminders are switched off
>
> `library_settings.overdue_reminders_enabled` is `false` in this deployment and
> stays false until **all four** of these are true: a production email provider
> is configured, a sending domain exists, SPF and DKIM are published for it, and
> the consent and privacy questions about writing to guardians are settled.
> Locked by the owner on 18 August 2026 — ADR-032.
>
> Everything below is built, tested and reachable. With the switch off, the
> daily job returns `{ enabled: false, due: 0, sent: 0, … }`, claims nothing and
> writes nothing. **No real message has ever left this application**; in
> development mail is captured to `.mail/` and read at `/dev/mail`.

---

## 1. There are exactly two

**Due soon** — a book is approaching its date.
**Overdue** — a book's date has passed and it has not come back.

That is the whole list, and it is deliberately short. This library charges no
fines, has no reservations to notify anybody about, and does not confirm returns
by email. Every message it sends is one a parent has to read, so the bar for
adding a third is that somebody would otherwise not know something they need to.

Both are one template, `loan_reminder`, because they are the same message at
different points on the same timeline. Splitting them would invite the second
one to grow a sterner voice.

---

## 2. Who is written to

**The guardian, never the child.** Children in this library have no email
address — that is why the guardian relationship exists — and the address is
chosen exactly as password recovery chooses one: the primary guardian, then the
oldest link.

A loan whose member has no guardian on file produces no message and **claims no
occurrence**. Nothing is burnt: if an address is added tomorrow, the reminder can
still go out. The run reports it as `noRecipient` so a silent gap is a visible
number.

Which accounts generate reminders is an allowlist, for the same reason borrowing
is one (ADR-028):

| State | Reminded | Why |
|---|:--:|---|
| `ACTIVE` | ✅ | The ordinary case |
| `SUSPENDED` | ✅ | Usually paused *because* a book has not come back. A polite note is this library's only remedy, and stopping at exactly that point removes it |
| `INVITED` | ❌ | Cannot borrow, so has no loans |
| `DEACTIVATED` | ❌ | The family has left |
| `ARCHIVED` | ❌ | The family has left |

A book still out on a deactivated account is a conversation for a person. It
stays on the desk's list; nobody's inbox is used to chase it.

---

## 3. When

`library_settings.overdue_reminder_offsets`, as whole days from the due date.
Negative is before, positive is after. The default is `[-2, 0, 3, 7]`:

```
        -2            0            +3           +7
   two days      the day       three days    a week
   before        it is due     after         after
   └── DUE_SOON ────────┘      └──── OVERDUE ──────┘
```

The boundary sits at the due date itself. Due dates are stored as the last
moment of their day, so **on** the day a book is due it is not late — offset `0`
is a gentle "due back today", and `+1` is the first nudge.

All arithmetic is calendar arithmetic in `library_settings.timezone`. A job
running at 03:00 UTC is running at 08:30 in Kolkata, and the answer to "how many
days until this is due" must be the library's answer, not the server's. The
functions live in `src/lib/notifications.ts`, pure and unit-tested; nothing
re-derives them in SQL.

Nonsense is dropped rather than obeyed: non-integers, and anything more than 90
days from a due date, are filtered out by `normaliseReminderOffsets`. A reminder
400 days late is a typo, not a policy.

**The switch.** `library_settings.overdue_reminders_enabled` defaults to
**false**. A library turns its own reminders on, having decided that writing to
guardians is what it wants. With it off the job does nothing at all — no claims,
no messages, no rows.

---

## 4. Saying it once

This is the part that matters most. A reminder that arrives every single morning
is not a reminder; it is a thing people filter, and then the library has no
mechanism left.

Every message is **claimed before it is sent**:

```
loan_notification
  UNIQUE (loan_id, due_at, offset_days)
```

The insert *is* the lock. There is no read-then-write window for a second cron —
or an operator running the job by hand at the same moment — to slip through: two
inserts of the same occurrence cannot both commit, and the loser skips.

`due_at` is in the key deliberately, and it is what makes renewal work with no
cancellation logic anywhere:

> The job derives offsets from the loan's **current** due date. Renewing moves
> that date, so every occurrence belonging to the old one becomes unreachable —
> and the new date's occurrences are unclaimed and available. Nothing has to
> remember to cancel a scheduled message, because nothing was ever scheduled.

### A failed send is not retried

If a provider reports failure, the claim row stays with `status = FAILED` and
that occurrence is spent. The delivery record in `email_event` carries the
provider's error.

This is a choice, and the cost is real: a family may miss one note. The
alternative is worse. A provider that reports a failure it actually delivered
would produce a second copy the next morning, and a library that cannot be
trusted not to spam is a library whose reminders get filtered. A missed reminder
is recoverable — the next configured occasion comes round, and the desk's
overdue list never depended on email in the first place.

### The window between claiming and sending

Claiming happens first and sending second, which leaves a window: if the process
dies between the two, the row stays `QUEUED` and that occurrence is lost in the
other direction — nothing was sent, and the claim stops a later run from trying.
The window is small, and the ordering is the right way round. The reverse — send,
then record — turns a crash into a **duplicate** message, and duplicates are the
failure this whole mechanism exists to prevent.

Nothing surfaces `QUEUED` rows today. The query is in `docs/OPERATIONS.md` under
*"Did the reminder actually go out?"*, and an old `QUEUED` row is the signature.

### Retry and delivery tracking are production-readiness work

Both gaps above — the spent failure and the crash window — are known, documented
and deliberately unclosed. Reliable retry and delivery tracking belong to the
production-readiness phase, to be designed against a provider that is actually
sending, with its real failure modes in hand. **No queue, background worker,
second provider or delivery dashboard was built** (ADR-032, decision 4). Building
retry machinery for a feature that is switched off would mean inventing
operational behaviour before the operation exists.

Neither gap can corrupt anything. A `loan_notification` row is not the source of
truth for a loan, a due date or an overdue state; deleting every row in the table
would change nothing except which reminders a later run considers unsent.

---

## 5. What a reminder may never do

**It cannot change anything about a loan.** The notification path writes exactly
two kinds of row — `loan_notification` and `email_event` — and touches no loan,
no due date, no renewal count, no book status, and no member. A test asserts all
of that after a send, including that no `loan_event` was appended: a reminder is
not something that *happened to* the loan.

**It is not the source of truth for overdue.** Overdue is still
`status = 'ACTIVE' AND due_at < now()`, derived at read time (ADR-025). A day
when this job does not run leaves one morning's messages unsent and the
library's account of its books exactly as true as it was.

**It carries nobody else.** One child, one book, one date. No other family
appears in any message, and the claim row stores no recipient address — who was
written to lives in `email_event`, once, so a family leaving means one place to
clear rather than two.

**There is no link in it.** Nothing to click, nothing to log into. The book
comes back to a room, not to a URL, and a reminder carrying a login link is one
more link for somebody to imitate.

---

## 6. The words

Written in `src/lib/notifications.ts`, where a test can read them.

> Aarav borrowed The Jungle Book from the library, and it was due back on 10
> August. Please send it in with them whenever you can.
>
> The book is The Jungle Book (MJCL-B0001).
>
> There is nothing to pay and nothing to do online — just pop it in the bag on
> the next library day.

The overdue message **names the date rather than counting days**. "Six days
late" is a score somebody is keeping. It contains no consequence, because there
is none. A unit test asserts the sentence never contains *overdue*, *fine*,
*fee*, *penalty*, *charge*, *owe*, *urgent*, *immediately*, *must* or *failure*.

---

## 7. Running it

The daily cron at `/api/cron/daily`, guarded by `CRON_SECRET`, at 03:00 UTC —
08:30 in Asia/Kolkata (`vercel.json`). Reminders run **last** in
`runDailyMaintenance`, after the hygiene steps, and inside a `try` that cannot
fail the rest: a mail server having a bad morning must not stop the library's
own housekeeping.

The response says what happened:

```json
{
  "status": "ok",
  "reminders": {
    "enabled": true, "due": 3, "sent": 2,
    "failed": 0, "alreadySent": 1, "noRecipient": 0
  }
}
```

Safe to run twice. Safe to run twice at once.

### In development

`EMAIL_PROVIDER=console` writes every message to `.mail/` and never opens a
socket, so nothing can reach a real family from a laptop. Read them at
`/dev/mail`, which 404s in production.

To exercise a run by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily
```

---

## 8. Not built

In-app notifications. WhatsApp. SMS. Return confirmations. Anything about a
renewal request being answered — a child sees that on their own screen, and an
email to a parent about a fortnight's extension would be noise. Digests. Per-
family preferences.

The channel abstraction the blueprint sketches (`NotificationService` with
pluggable channels) is **not** built. There is one channel, email, reached
through `EmailService`. Building the abstraction before a second channel exists
would be building a shape with nothing to hold.
