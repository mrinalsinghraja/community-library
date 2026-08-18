# Phase 4 — Reminders, and a child asking to keep a book

Delivered 17 August 2026. Circulation's missing half: the library can now tell a
family a book is due, and a child can ask to keep one longer.

Two features, nothing else. Reports, announcements, a settings screen and
production deployment were explicitly excluded.

---

## 1. The numbering, settled

The blueprint's six-phase table (§24) and the delivered sequence had drifted
apart — `docs/EMAIL.md` called reminders "Phase 4" while `docs/PHASE-0.md` and
`docs/ENVIRONMENT_VARIABLES.md` called email "Phase 5", and the blueprint's own
Phase 4 named circulation, which shipped as Phase 3. **The delivered sequence is
the one that counts, and it is:**

| Phase | Delivered |
|---|---|
| 0 | Foundation |
| 1 | Identity |
| 1.1 | Privacy and guardian verification |
| 2 | Catalogue |
| 3 | Circulation |
| **4** | **Notifications and renewal requests** |

Production polish — a settings and branding screen, reports, announcements, the
accessibility sweep, the production checklist and the deployment itself — is a
later phase and is not numbered here until it is scoped.

Every forward reference in the documentation was corrected to match.

---

## 2. What was built

### A — Circulation notifications

Due-soon reminders and overdue nudges to the guardian, through the email
provider abstraction that has existed since Phase 1 and the daily cron that has
existed since Phase 0.

Full detail in **`docs/NOTIFICATIONS.md`**. The shape:

- Two message kinds, one template, written to the parent.
- Offsets from `library_settings.overdue_reminder_offsets` — default
  `[-2, 0, 3, 7]` days from the due date — evaluated in the library's timezone.
- Off unless `overdue_reminders_enabled` is true. Default false.
- Every message claimed in `loan_notification` before it is sent, unique on
  `(loan_id, due_at, offset_days)`.
- The notification path cannot write to a loan, a book or a member.

Two settings left the dormant list in this change, which is the only way a key
is allowed to leave it: `overdue_reminder_offsets` and
`overdue_reminders_enabled` now decide what happens.

### B — Renewal requests

A child asks; a librarian decides; approving runs the desk's own renewal.

Full detail in **`docs/RENEWAL_REQUESTS.md`**. The shape:

- `PENDING → APPROVED · DECLINED · CANCELLED`, using the enum that shipped in
  migration 1.
- At most one pending request per loan, enforced by a partial unique index.
- Until a librarian answers, **nothing about the loan has changed**.
- Approval calls `renewLockedLoan` — the same code the desk button runs — in one
  transaction with the decision, re-checking every rule against the loan as it
  stands then.
- The child's action takes the book code, never a loan id.

---

## 3. Database

Migration `20260817220000_phase4_notifications_and_renewal_requests`.

| Change | Why |
|---|---|
| `loan_notification` table + `LoanNotificationKind` enum | One row per reminder claimed. No recipient column — that lives in `email_event`, once |
| `UNIQUE (loan_id, due_at, offset_days)` | Duplicate suppression, and the concurrency guard |
| `renewal_request_one_pending_per_loan` (partial) | One open ask per loan; decided ones accumulate |
| `loan.request_renewal` permission + grants to MEMBER and SUPER_ADMIN | So an already-migrated library works without waiting for somebody to re-run the seed |

**Step 0 refuses** if any loan somehow already holds two pending requests,
naming them, rather than choosing one to delete — the same principle as
migration 6 (ADR-027). On every real database this does nothing: the table has
never been written to.

Nothing was deleted, rewritten or invented. `loan_notification` starts empty,
which correctly means "no family has been written to yet".

Verified on a clean database and on a Phase-3 database, with `prisma migrate
diff` reporting no drift afterwards.

---

## 4. What Phase 4 deliberately does not include

Reports · announcements · a settings or branding admin screen · production
deployment · in-app notifications · WhatsApp or SMS · return-confirmation email
· an email when a renewal request is decided · a notification channel
abstraction · reservations, holds or waiting lists · fines · digests ·
per-family notification preferences · bulk approval.

`renewal_blocked_when_reserved` and `block_on_overdue_days` remain dormant and
undocumented as behaviour, because both would require inventing policy the owner
has not set. `email_enabled` **joined** the dormant list in this phase: it
defaults to false, and a false that silently stopped activation links would lock
families out of the library with nothing on screen to explain it.

---

## 5. Tests

**556 passing** (197 unit + 359 against real PostgreSQL, 26 files), up from 490.

New files:

- `tests/unit/notifications.test.ts` — offset arithmetic across a timezone
  boundary, the DUE_SOON/OVERDUE boundary at the due date itself, offset
  normalisation, the notifiable-status allowlist, and the words the messages are
  forbidden from containing.
- `tests/database/notifications.test.ts` — 19 tests: eligibility and every
  exclusion, the switch, the same day twice, two jobs at the same instant, a
  renewal retiring the old date's reminders, a failed send recorded and not
  retried, and a full assertion that a send changes nothing about a loan.
- `tests/database/renewal-requests.test.ts` — 33 tests: the lifecycle,
  ownership and privacy isolation, duplicate asks, the rules at ask time and at
  decision time, parallel approvals, approve-versus-decline, and a desk renewal
  racing an open request.

Four existing tests changed because Phase 4 changed the truth they asserted:
the active-settings list, the reader's permission set (twice), and the rule that
a reader holds only `.view` keys — now stated as the rule that actually matters,
that a reader holds none of circulation's four write permissions.

### A Phase 3 test that was wrong, found by CI

`circulation-concurrency.test.ts` → *"does not let a return and a renewal both
land on one loan"* demanded exactly one of the two to succeed. It passed on a
laptop and failed on the CI runner, and the Phase 3 report already noted one
unexplained failure in this file.

It was wrong about the library, not about the timing. Both orderings are
legitimate: if the return wins the loan's row lock the renewal is refused, but
if the **renewal** wins, both succeed — and correctly, because keeping a book
longer and then bringing it back an instant later is an ordinary afternoon at a
desk. The old assertion was a coin toss dressed as an invariant.

It now asserts what must actually hold however the two race: at most one RETURN
event and at most one RENEW event, `renewal_count` equal to the number of RENEW
events, the loan's status agreeing with whether a RETURN happened, and the copy's
status agreeing with the loan. **No product code changed** — this was a test
stating something untrue about a system that was behaving correctly.

The notification suite had a defect of its own in the same run: its helper built
due dates with `setHours` in the *machine's* timezone, so every case shifted by a
calendar day on a UTC runner. It now builds them with `endOfDayInTimezone` in the
library's timezone — the same function the service uses. Also product-code-clean,
and a good argument for running the suite under `TZ=UTC` locally, which is now
how it is verified.

---

## 6. Known limitations

- **Reminders are switched off**, and stay off until a production email provider,
  a sending domain, SPF and DKIM, and the consent decisions are all in place.
  Locked by the owner on 18 August 2026 — ADR-032. Not a gap: a precondition.
- **A failed reminder is not retried.** The occurrence is spent and the row
  reads `FAILED`. Reasoned in ADR-029; the trade is deliberate.
- **A crash between claiming and sending loses that occurrence.** The row stays
  `QUEUED`. Nothing surfaces `QUEUED` rows today.
- Those two together are the **production-readiness item**: reliable retry and
  delivery tracking are a later phase's work, to be designed when the system is
  actually sending. No queue, worker, second provider or delivery dashboard was
  built for a feature that is off (ADR-032, decision 4).
- **No screen shows the delivery log.** "Did the guardian get it?" is answerable
  from `email_event` with SQL, not from the UI.
- **No email when a request is decided.** By design, but it means a child who
  does not open the app does not learn the answer until they next look.
- **`/my-books` was verified in the browser this phase** — including the ask,
  the pending state and the decided state — but the child-side sign-in is the
  step that failed in Phase 3, so see §7 for exactly what was and was not
  driven.
- **Still not deployed.** Blocked on Neon projects, unchanged from Phase 3.

---

## 7. Decisions — settled, and still open

### Settled by the owner, 18 August 2026 (ADR-032)

| Question | Decision |
|---|---|
| Turn reminders on? | **No.** `overdue_reminders_enabled` stays `false` until a provider, a sending domain, SPF/DKIM and the consent questions are all done |
| `renewal_period_days` — 14 or the platform's 7? | **14**, final. 17 Aug → 31 Aug → 14 Sep is the library's own worked example |
| `DECLINED` or `REJECTED`? | **`DECLINED` stays**, no migration. Child-facing wording stays friendly and separate: "Not this time" |
| Retry and delivery tracking? | **Not now.** Documented as a production-readiness item, not built |

These are no longer open, and the documentation no longer asks about them.
`docs/PHASE-3.md` §4.1 and `docs/CIRCULATION.md` §10 point here rather than
repeating the question.

### Still open

1. **The offsets.** `[-2, 0, 3, 7]` — two days before, on the day, then three
   and seven days after. Reasonable, but they are a judgement about how often it
   is acceptable to write to a parent, and nothing is sent until reminders are
   enabled anyway.
2. **A real sending domain.** Nothing can leave this server until
   `EMAIL_PROVIDER` is configured with SPF and DKIM (`docs/EMAIL.md`). This is a
   prerequisite of turning reminders on, not a separate feature.
3. Carried from Phase 3, still open: no renewal of an overdue book; no general
   correction screen; `LoanStatus` dropping LOST and WRITTEN_OFF.

---

## 8. What came next

**Phase 5 — Administration & Configuration** (`docs/PHASE-5.md`): settings,
branding and a read-only audit viewer. It changed nothing about notifications or
renewal requests except one thing — the reminder switch now has a screen, which
refuses to enable it while `EMAIL_PROVIDER=console`. Reminders remain off.
