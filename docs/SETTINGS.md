# Settings, branding and the audit viewer

Everything a library decides about itself lives in one row — `library_settings`
— and until Phase 5 the only way to change any of it was an `UPDATE` typed at a
production database holding children's records. This document is what replaced
that.

Three screens, and no more:

```
ADMIN
├── Settings    /admin/settings    settings.view · settings.edit
├── Branding    /admin/branding    branding.edit
└── Audit       /admin/audit       audit.view
```

In Version 1 all three permissions belong to the Super Admin alone. A librarian
runs the library; they do not get to change what the library *is*.

---

## 1. The rule that matters most

**A setting decides the future, never the past.**

Changing the loan period from 14 days to 21 does not move a single due date a
child has already been told. Nothing in the settings service touches a loan, a
due date, a consent record, a code that has been printed, or an audit row. The
next book that goes out uses the new number; the book in a nine-year-old's bag
keeps the date on the slip.

The same holds for every other value:

| Change | What happens to what already exists |
|---|---|
| Loan period | Existing loans keep their `due_at` |
| Renewal period | A loan already renewed keeps its date and its count |
| Maximum books / renewals | Nothing is retrospectively refused or cancelled |
| Card or label prefix | Cards and labels already issued keep their codes |
| Guardian verification strength | Accounts already approved stay approved |
| Catalogue visibility | Takes effect on the next request, for everybody |

Four tests in `tests/database/settings.test.ts` hold this line.

---

## 2. What can be changed

### Your library

| Setting | Column | Notes |
|---|---|---|
| Library name | `library.name` | Not on the branding screen — one field, one home |
| Timezone | `timezone` | Any IANA zone the server knows; a short list is offered |
| How dates are written | `date_format` | Four `date-fns` patterns, chosen from a list |

### Borrowing

| Setting | Column | Range | The library's own |
|---|---|:--:|:--:|
| Days a book can be kept | `borrowing_period_days` | 1–30 | **14** |
| Books one child can have | `max_active_loans` | 1–5 | **2** |
| Times a book can be kept longer | `max_renewals` | 0–3 | **1** |
| Extra days when it is kept longer | `renewal_period_days` | 1–30 | **14** |

The four values in the last column are the owner's, locked by ADR-032. The
ranges exist because this form is now the only place they can be changed, and a
typo of `140` in the loan-period box would hand books out for five months.

### Readers and books

| Setting | Column | Rule |
|---|---|---|
| Youngest / oldest age | `age_min`, `age_max` | 2–18, and youngest ≤ oldest |
| Library card prefix | `member_code_prefix` | 2–10 characters, capitals, digits and hyphens |
| Book label prefix | `copy_code_prefix` | Same rule, separate namespace (ADR-023) |
| Who can look at the shelf | `catalogue_visibility` | `MEMBER_ONLY` (default) or `PUBLIC` |

### Guardian verification

Its own section, its own save, its own tick box, because it is the setting that
decides what evidence the library holds that the adult approving a child's
account is that child's guardian.

Selectable: **Self-declared only** · **Email confirmed** · **Checked by a
librarian**.

Not selectable, deliberately:

* `NONE` — "require nothing at all" should not be one tap away on a screen about
  children's accounts.
* `IDENTITY_PROVIDER` — nothing implements it, so requiring it would make every
  approval impossible. A fail-closed nobody should be able to walk into.

The warning on the screen stays, and it says what it means: this software does
not give legal advice, and the strength this deployment needs is a question for
someone qualified. See `GUARDIAN_VERIFICATION.md` and `CONSENT.md`.

### Consent wording

**Read-only, on purpose.** The version is shown; it cannot be edited here.

The words a guardian agrees to live in `src/lib/consent.ts` and every consent
record stores a verbatim snapshot of the text that was shown. A version number
that could be changed without the words changing would make a record describe
wording nobody ever saw. New wording is a release, and a release writes a new
version — history is never rewritten. See ADR-033.

### Reminder emails

`overdue_reminders_enabled`, default **false**, and still false in this
deployment (ADR-032).

**The switch is hard-blocked while `EMAIL_PROVIDER=console`.** Not warned
about — blocked, in both halves:

* the screen renders **no control at all**, only a sentence saying reminders
  cannot be enabled until a production email provider is configured;
* `setOverdueReminders(true)` throws `RuleViolationError` regardless of what
  reached it, so a hand-written request is refused exactly as a missing button
  is.

Turning reminders **off** is always allowed. Silence is never the dangerous
direction.

---

## 3. Branding

One colour, a greeting, two pieces of text, contact details, and a logo. Not a
theme builder: there is no second colour, no font control, no stylesheet field.

| Setting | Column | Notes |
|---|---|---|
| Library colour | `primary_color` | `#rrggbb`, and **≥ 3:1 contrast against white** |
| Welcome message | `welcome_message` | ≤ 160 characters, the first thing a child reads |
| About how the library works | `rules_markdown` | Plain text, ≤ 8000 characters |
| About donating books | `donation_policy_markdown` | Plain text, ≤ 8000 characters |
| Library email / phone | `contact_email`, `contact_phone` | Emptied means null, not `""` |
| Logo | `logo_url` | PNG, JPEG or WebP, ≤ 2 MB |

**The colour is measured, not judged.** The library's drawn mark is white shapes
on this colour, so a pale choice makes it disappear; `contrastRatio()` applies
WCAG's own formula and the save is refused below 3:1 — the threshold for a
graphical object. Not 4.5:1, because no text is printed on this colour.

**The text fields are plain text.** They are rendered by React as text, with no
markdown parser and no HTML, so there is nothing to sanitise and nothing to
escape by hand. The field names still end in `Markdown` because the columns do.

**SVG logos are refused.** `UPLOAD_RULES` permits SVG for the branding purpose,
and the service narrows it: an SVG is a document that can carry script, and a
logo is the one image shown to visitors who have not signed in. Next's image
optimiser also refuses SVG by default, so an uploaded one would render as a
broken mark on every screen. See ADR-034.

A logo is stored through the same gate as every other upload — magic-byte
sniffing, executable refusal, metadata stripped, random storage key — and served
through `/api/media/[id]` in every environment, which is also why replacing one
schedules the old object for deletion in the same transaction. See `MEDIA.md`.

**Preview.** The branding screen shows "How children will see it" — logo, name,
welcome message. It renders the **saved** state, not a live one: a preview that
updates as you type is a nice trick and a lie about what a child will see.

---

## 4. Not available yet

Rendered on the settings screen as text. Nothing in this list gets a control of
any kind, because a control that looks like a rule and is not one is worse than
a missing feature — it is a promise the software will not keep.

| Named on the screen | Backed by | Why not |
|---|---|---|
| Reserving a book | `renewal_blocked_when_reserved` | There is one shelf in one room |
| Stopping a child borrowing while a book is late | `block_on_overdue_days` | A late book would become a closed door for a nine-year-old |
| A single switch for all email | `email_enabled` | It would silently stop the links families need to join |
| Reports | `report.view` | Not built |
| Announcements | `announcement.manage` | Not built |
| Overriding a borrowing rule at the desk | `loan.override_rules` | Not built |
| Marking a book lost | `loan.mark_lost` | Condition is changed on the book's own page |

`report.view` and `announcement.manage` **joined `DORMANT_PERMISSIONS` in Phase
5**. They were seeded in Phase 0 and have never guarded anything.

The guarantee is structural, not cosmetic: `updateLibrarySettings` assembles its
update from `EDITABLE_SETTING_FIELDS` one key at a time and never spreads the
parsed form, so a dormant column has no path into the database through this
screen whatever a tampered submission contains. Tests in
`tests/unit/dormant-configuration.test.ts` and `tests/database/settings.test.ts`
hold both halves.

---

## 5. The audit viewer

Read-only in the strongest sense available: `audit-service.ts` contains no
update, no delete and no export, the page contains no form but a `GET` filter,
and no service anywhere in the application touches `audit_log` after a row is
written.

Filters: date from/to · who (matched against the denormalised actor label) ·
what happened · kind of record. 25 rows a page, newest first. Always scoped to
the actor's own library.

**Details are shown for configuration changes only.** `settings.updated` and
`branding.updated` carry a before/after of the library's own policy numbers, and
no person. Every other action's `metadata` belongs to a child, a family or a
book, so the service does not return it at all — it is withheld before the page
renders, not hidden by a component. See ADR-035.

That is a narrowing on top of the existing protection, not a replacement:
`redactMetadata` still strips anything credential-shaped at write time, and
nothing in Phase 5 relaxes it.

Branding audit rows record **which fields changed**, never the text — eight
thousand characters of rules copy do not belong in a log.

---

## 6. How a change is made safe

Every write on these screens:

1. **Is authorised in the service.** `requirePermission("settings.edit")`,
   `"branding.edit"`, `"audit.view"` — never a role-name check, never a decision
   made in a page or an action.
2. **Is validated in the service.** The Zod schemas in
   `src/lib/settings-schema.ts` are parsed by `updateLibrarySettings` and
   `updateBranding` themselves, so validation cannot be skipped by posting
   directly. The form renders `min`/`max` from the same constants, so what the
   browser suggests and what the server enforces cannot drift.
3. **Is written in one transaction**, with the audit row inside it.
4. **Reads its "before" from the database, not from a cache.** `getAdminSettings`
   and the update functions deliberately avoid `getCurrentLibrary()`: that
   accessor is wrapped in React's `cache()`, and a server action shares a request
   with the render that follows it, so a screen that saved a change and then
   re-read it through the cache would show the person their own old value.
5. **Refreshes the whole tree.** `revalidatePath("/", "layout")`, because the
   library's name and colours are read by every page including the children's.

---

## 7. What Phase 5 did not do

No schema change and no migration — every column already existed. No reports, no
announcements, no retention or deletion implementation, no notification retry, no
delivery log, no role editor. `role.manage` is still seeded and still guards
nothing: roles and their permissions are defined in code
(`src/lib/permissions.ts`) and seeded, which is deliberate — a permission editor
is the fastest way to give somebody the wrong access by accident.
