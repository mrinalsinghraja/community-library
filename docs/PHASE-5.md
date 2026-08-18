# Phase 5 — Administration & Configuration

**Delivered:** 18 August 2026 · **Schema change:** none · **Migration:** none

---

## 1. Why this phase existed

Every production decision this deployment still has to make — what evidence of
guardianship a registration must reach, whether reminders are on, what the
library is called, what colour it is — was a hand-written `UPDATE` against a
database holding children's records. Phase 5 is the screen that replaced that,
and nothing else.

The roadmap reconciliation that preceded it named this the only
required-before-production item with no external dependency: no Neon project, no
lawyer, no DNS.

---

## 2. What was built

| Screen | Route | Permission |
|---|---|---|
| Settings | `/admin/settings` | `settings.view` / `settings.edit` |
| Branding | `/admin/branding` | `branding.edit` |
| Audit | `/admin/audit` | `audit.view` |

Three links in the desk header, visible only to whoever holds the permission.
Full reference: **[`SETTINGS.md`](SETTINGS.md)**.

New files:

- `src/lib/settings-schema.ts` — bounds, allowlists, the unavailable-features
  list, Zod schemas, and the WCAG contrast function.
- `src/server/services/settings-service.ts` — read, update, branding, logo,
  guardian verification, reminder switch.
- `src/server/services/audit-service.ts` — the read side of the log.
- `src/server/actions/settings-actions.ts`, and the three pages with their forms.

Changed: `staff-shell.tsx` (three nav links) · `media-service.ts`
(`storeBrandingImage`, and a branding branch in `getAuthorizedMedia` so a
signed-out visitor can see the logo) · `permissions.ts` (`report.view` and
`announcement.manage` joined `DORMANT_PERMISSIONS`) · `library-logo.tsx` (the
drawn mark now uses the configured colour).

---

## 3. The four decisions worth naming

1. **A setting decides the future, never the past.** Nothing in this phase can
   move a due date, a code, a consent record or an audit row. Four tests hold it.
2. **The consent version is read-only** (ADR-033). Wording lives in code; a
   version that could drift from its own words would make consent records
   describe text nobody saw.
3. **A logo may not be an SVG** (ADR-034), even though the upload gate allows
   one — it is the only image shown to signed-out visitors, and Next refuses to
   optimise it anyway.
4. **The audit viewer shows details for configuration changes only** (ADR-035).
   Everything else's metadata is about a child, and is dropped in the service.

---

## 4. What Phase 5 deliberately does not include

Reports · announcements · a role or permission editor · deployment · Neon or
Vercel setup · DNS · a production email provider · SPF/DKIM · retention or
deletion · notification retry · a delivery log · a per-loan detail page ·
Playwright · axe · guardian sign-in · Junior Librarian · reservations · holds ·
fines · gamification · dashboards · analytics · WhatsApp or SMS.

**No statistics were added anywhere.** There is no chart, no count-of-loans
tile, no "activity" panel. The admin screens are forms and a table.

---

## 5. Tests

**648 passing** (231 unit + 417 against real PostgreSQL, 30 files), up from 559.

| File | Adds |
|---|---|
| `tests/unit/settings-schema.test.ts` | 34 — bounds, prefixes, timezone, date formats, the contrast floor, the allowlists |
| `tests/database/settings.test.ts` | 26 — authorization, existing loans untouched, tampered submissions, audit contents, branding, verification, the reminder block |
| `tests/database/audit-viewer.test.ts` | 16 — permission, tenancy, filters, pages, the details narrowing, and that reading changes nothing |
| `tests/database/branding-media.test.ts` | 11 — upload, claim, SVG refusal, replacement, removal, public readability |
| `tests/unit/dormant-configuration.test.ts` | rewritten: the "no settings screen exists" assertion was replaced by the two that now carry the promise |

That last one is worth spelling out. The Phase 3 test said *"there is no
settings UI in Version 1 at all, which is the simplest possible way of not
showing a librarian an inert control. If one is ever built, this test fails and
the builder has to decide what to do about the dormant fields — which is the
whole point."* It failed, as designed, and the decision it demanded is now two
assertions: a dormant column is never on `EDITABLE_SETTING_FIELDS`, and every
dormant column and permission is named in `UNAVAILABLE_FEATURES`.

---

## 6. Browser walkthrough

Driven against the dev server on 18 August 2026, signed in as the demo Super
Admin, the demo Librarian and the demo Reader in turn.

| # | Step | Result |
|---|---|---|
| 1 | Super Admin opens Settings | ✓ four sections, one Save |
| 2 | Librarian opens `/admin/settings`, `/admin/branding`, `/admin/audit` | ✓ all three land on `/account` |
| 3 | Super Admin changes the loan period 14 → 21 | ✓ saved, audit row names the change and the actor |
| 4 | The book already borrowed | ✓ `due_at` and `renewal_count` unchanged, no new loan event |
| 5 | The next book issued at the desk | ✓ desk showed "Due back Tuesday 8 September 2026 (21 days)", and the stored loan matches |
| 6 | Super Admin changes the colour and welcome message | ✓ saved; audit records field names, not the text |
| 7 | The children's front page | ✓ new welcome, new mark colour, "for 21 days" on `/rules` |
| 8 | The reminder switch under `EMAIL_PROVIDER=console` | ✓ no control at all — 0 forms, 0 inputs in that card |
| 9 | Forcing it server-side | Covered by test, not by browser — see below |
| 10 | "Not available yet" | ✓ seven items, 0 controls of any kind |
| 11 | The audit page | ✓ 30 records, 2 pages, filters by action/actor/kind/date; details only on the two configuration rows |
| 12 | Editing audit data | ✓ the only `POST` form on the page is Sign out |
| 13 | The child on every admin and desk route | ✓ all land on `/account` |
| 14 | 375 px, 768 px, desktop | ✓ no page-level horizontal overflow; the audit table scrolls inside its own `overflow-x: auto` box |

**Honest notes on what the browser could not show.**

- **Step 9** was not driven in the browser. Forging a Next server-action request
  needs an action id, and the blocked page ships none — which is itself part of
  the answer. The server-side refusal is proven by
  `tests/database/settings.test.ts` → *"cannot be turned on while email reaches
  nobody"*, which asserts both the thrown error and the message a librarian
  would see.
- **Logo upload** was not driven in the browser either: this browser tool cannot
  attach a file to a file input. The whole path — store, claim, refuse an SVG,
  replace, remove, read while signed out — is covered by
  `tests/database/branding-media.test.ts`.
- The preview pane intermittently reported itself hidden, so some clicks were
  issued through the page's own elements rather than at coordinates. Every
  assertion above was read back from the DOM or from the database.
- Dev data was restored afterwards: loan period back to 14, colour and welcome
  message back to their seeded values. The extra demo loan issued in step 5 was
  left in place.

---

## 7. Quality gate

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `TZ=UTC npm run test:all` | 648 passed, 30 files |
| `npx prisma validate` | valid |
| `prisma migrate status` / `migrate diff` | up to date, no drift — nothing changed |
| `npm run build` | clean, 32 routes |
| `gitleaks detect` | no leaks |
| CI | see the commit |

---

## 8. Known limitations

- **`role.manage` still guards nothing.** Roles and their permissions are
  defined in `src/lib/permissions.ts` and seeded. A permission editor is the
  fastest way to hand somebody the wrong access by accident, and this library
  has five roles that have not changed since Phase 0.
- **No settings history view.** The audit log holds every change; the settings
  screen does not show "what this was last week". The audit page answers it.
- **The branding preview is the saved state**, not a live one.
- **`secondary_color` is not editable.** One colour, deliberately. The second is
  a design-system token.
- **Favicon is not editable.** The column exists; there is no upload for it, and
  a second image control for something nobody has asked for is scope.
- **Changing a code prefix does not renumber anything**, which is correct, but it
  means a library can end up with two prefixes in circulation. That is a
  physical-label reality, not a software one.
- **Still not deployed.** Blocked on Neon projects, unchanged since Phase 3.

---

## 9. Decisions the owner still has to make

Unchanged by this phase, and now *makeable on a screen*:

1. The required guardian verification strength for real use — currently
   `SELF_DECLARED`, which is the development default and means "a box was
   ticked".
2. Who reviews the consent wording before real children's data is entered.
3. Retention periods, and what an account deletion request does.
4. Whether to build the desk "copy activation link" fallback, so onboarding
   survives a spam folder.
5. When the Neon projects can be created.

---

## 10. Stop condition

Settings ✓ · branding ✓ · guardian verification ✓ · reminder control ✓ ·
audit viewer ✓ · dormant handling ✓ · no schema change ✓ · tests ✓ · browser
walkthrough ✓ · responsive ✓ · docs ✓

**The next phase has not been started.**
