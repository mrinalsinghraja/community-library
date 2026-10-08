# Rebranding for your own community

This software was first built for one community's children's library. Nothing
about that community is compiled into the code: its name, colours, loan rules
and card prefixes are configuration. This guide shows what to change, in what
order, and how to check it worked.

> **Status.** Written from the source (`prisma/seed/library-config.ts`,
> `prisma/seed/library.ts`, the branding and settings screens) and not yet
> followed end to end on a fresh clone. If you do, and something here differs,
> please [open an issue](https://github.com/mrinalsinghraja/community-library/issues)
> or send a fix.

## The one idea to hold on to

Your branding lives in two places, used at two different times:

| When | Where | What it is for |
|---|---|---|
| **Before the first seed** | `prisma/seed/library-config.ts` | The starting values for a brand-new database |
| **After that** | The admin screens (`/admin/settings`, `/admin/branding`) | Every later change, made by a Super Admin |

The seed is **safe to re-run and never overwrites settings an administrator has
changed** (`prisma/seed/library.ts`). So editing the config file *after* the
library exists changes nothing. Use the admin screens instead.

## Before you start

Follow [`SETUP.md`](SETUP.md) as far as a working local database. Rebrand on a
**fresh** database. Do not point any of this at a library that already has real
readers in it.

## Step 1: Describe your community

Open `prisma/seed/library-config.ts`. The values for the first community are in
the exported object `MANA_JARDIN`. Edit its values in place.

| Field | What it controls | Notes |
|---|---|---|
| `community.name`, `city`, `addressLine` | Who the library belongs to | |
| `library.name` | The name shown on every screen, card and email | |
| `library.slug` | An internal identifier | **Set it once and never change it.** The seed looks the library up by this slug, so a different slug creates a *second* library in the same database. |
| `library.description` | A short public description | |
| `settings.ageMin`, `ageMax` | The age range the library is for | |
| `borrowingPeriodDays`, `maxActiveLoans`, `maxRenewals`, `renewalPeriodDays` | The loan rules | Small numbers on purpose; see the comment in the file |
| `allowRenewalWhenOverdue`, `blockOnOverdueDays` | What happens to a late book | |
| `copyCodePrefix`, `memberCodePrefix` (+ `...Padding`) | How book labels and reader cards are numbered | For example `ABC-B` and `ABC-R`, then a four-digit number |
| `catalogueVisibility` | Who can see the shelf | `MEMBER_ONLY` or `PUBLIC` |
| `primaryColor`, `secondaryColor` | The colours | Pick text colours with contrast in mind; see [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) |
| `welcomeMessage` | The greeting on the front page | |
| `venueName`, `venueAddress`, `eligibilityNote` | Where the books are, and who may join | Read in three different sentences, so write all three |
| `timezone` | Due dates are worked out in this timezone | For example `Asia/Kolkata` |

**Leave alone:**
- `consentVersion` comes from `src/lib/consent.ts`. The consent wording is
  versioned and needs a legal review before real children's data is entered; see
  [`CONSENT.md`](CONSENT.md).
- `overdueRemindersEnabled` is deliberately absent from the file. Reminders are
  switched on by a Super Admin on `/admin/settings`, and only once email is set
  up properly; see [`NOTIFICATIONS.md`](NOTIFICATIONS.md).
- Categories are not in this file. The starting shelves come from
  `DEFAULT_CATEGORIES` in `src/lib/catalogue.ts`, and there is no screen for
  adding more yet (see the roadmap in the [README](../README.md)).

## Step 2: Your logo

You have two options.

- **The quick way: upload it on the screen.** After you sign in as a Super
  Admin, open `/admin/branding` and upload your logo. An uploaded logo always
  wins over the packaged one. It cannot be an SVG.
- **The complete way: replace the packaged files** in `public/brand/`, which are
  used where an upload cannot reach (emails, the phone's app icon):

  | File | Used for |
  |---|---|
  | `library-mark.png` | The default mark on screen |
  | `library-mark-email-v2.png` | Emails |
  | `library-mark-print.png` | Shelf labels (drawing only, no wordmark) |
  | `app-icon-192.png`, `app-icon-512.png`, `app-icon-512-maskable.png` | The installable app icon |

  The print mark is also embedded in the code as text
  (`src/server/reports/packaged-print-mark.ts`) because a PDF is drawn on the
  server. An uploaded logo covers it; a replaced file does not until that file is
  regenerated.

Only use artwork you have the right to use.

## Step 3: Create the database content

```bash
npm run db:deploy      # apply migrations
npm run db:seed        # your configuration (NOT db:seed:demo)
npm run create-admin   # the first Super Admin; the password is typed and never echoed
```

`db:seed:demo` adds fake people and books and exists for development only.

## Step 4: Make later changes on the screens

Sign in as the Super Admin you just created:

- `/admin/settings` for the library name, timezone, loan rules, age range, card
  and label prefixes, and who can see the shelf.
- `/admin/branding` for the colour, welcome message, venue copy and logo.

Every change is recorded in the audit log.

## Step 5: Check it worked

1. Start the app (`npm run dev`) and open the front page. You should see your
   library's name, welcome message and mark.
2. Create a reader and look at the library card. The code should start with your
   prefix.
3. Make sure the first community's name is not in the source:

   ```bash
   npm run lint
   ```

   A lint rule forbids the first community's name and card prefix anywhere under
   `src/`, so a pass means the code is clean. They may appear in `prisma/seed/` and in tests.
4. Run `npm run verify`. A few tests **quote the first community's values**, for
   example `tests/unit/library-config.test.ts`. If you changed those numbers or
   names, those expectations will fail, and you should update them to match your
   configuration. They are checking the same rules against your values, not
   finding a bug.

## Things this guide does not cover

- **Email.** Nothing can be sent until you configure a provider and a sending
  domain; see [`EMAIL.md`](EMAIL.md).
- **Going live.** [`DEPLOYMENT.md`](DEPLOYMENT.md), then
  [`PRODUCTION.md`](PRODUCTION.md), then [`PILOT_TESTING.md`](PILOT_TESTING.md).
- **Legal review.** Guardian verification and consent wording both need review
  for your jurisdiction before you enter a real child's data; see
  [`GUARDIAN_VERIFICATION.md`](GUARDIAN_VERIFICATION.md) and
  [`CONSENT.md`](CONSENT.md).
