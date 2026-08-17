# Community Children's Library Platform — Implementation Blueprint

**Version 1 deployment:** Mana Jardin Children's Library
**Owner:** Mrinal Singh Raja (MrinalSinghRaja@gmail.com)
**Target domain:** `library.msrx.co.in`
**Status:** Blueprint — awaiting approval before implementation
**Date:** 2026-08-16

---

## 1. Executive Summary

We are building a **reusable Community Children's Library Platform**, deployed first as *Mana Jardin Children's Library*. It manages a small physical library of donated children's books in a corner of the community Yoga Room, serving children aged 5–14, free of charge, with voluntary book donation.

The system has three faces:

| Face | User | Design goal |
|---|---|---|
| **Reader app** | Children 5–14 | Delightful, huge type, few choices, no tables |
| **Desk app** | Librarians (adults now, children later) | Two-click issue/return, hard to get wrong |
| **Admin app** | Super Admin | Configuration, members, reports, audit |

**Core engineering positions:**

1. **Modular monolith on Next.js** — one deployable app, strict internal module boundaries. No microservices, no queues, no Kubernetes.
2. **Nothing about Mana Jardin is compiled in.** Names, logo, colours, age range, loan period, ID prefix, categories, rules all live in a `library_settings` row read through one typed accessor.
3. **Book title ≠ physical copy.** Two tables from day one. This is the single most expensive thing to retrofit later.
4. **Every tenant-scoped row carries `library_id`** from the first migration, and all data access goes through a scoped repository layer. Multi-community works later without a rewrite; no multi-tenant machinery is built now.
5. **Permissions are data, not `if (role === 'admin')`.** A `permission` catalogue plus `role_permission` mapping means Junior Librarian is a seed row, not a refactor.
6. **Children's privacy is a hard boundary.** No child sees another child's data, ever. No public page lists who borrowed what. No analytics or tracking on child-facing screens.
7. **Free to run.** Target: ₹0/month hosting for this scale — Vercel Hobby + Neon free Postgres + Resend free tier.

**Deliberately deferred** (architected for, not built): reservations/holds, reading badges, reviews, QR/barcode scanning, WhatsApp, push, multilingual, multi-community admin, digital reading.

---

## 2. Recommended Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | Server Components keep child data server-side; Server Actions remove a whole API surface; first-class on Vercel |
| Language | **TypeScript, `strict: true`** | Required by brief |
| UI | **React 19 + Tailwind CSS v4** | Design tokens as CSS variables → runtime theming from DB settings |
| Component base | **Hand-built design system** on Radix UI primitives | Radix gives accessible dialog/menu/tabs behaviour; visual layer is fully ours (a generic component kit would make it look like SaaS) |
| ORM | **Prisma 6** | Typed access, first-class migrations, familiar in your other projects |
| Database | **PostgreSQL on Neon** (see §2.1) | Free tier, auto-resume, branch-per-PR for tests |
| Auth | **Auth.js v5 (NextAuth) — Credentials provider + database sessions** | Mature, audited; DB sessions let us revoke instantly on suspend |
| Hashing | **argon2id** (`@node-rs/argon2`) | Current best practice; bcrypt acceptable fallback |
| Validation | **Zod** | One schema per input, shared client/server |
| File storage | **Vercel Blob** — private store for child photos, public for covers | No extra vendor; signed short-lived URLs for private objects |
| Email | **Resend** primary, **Nodemailer/SMTP** fallback, both behind one `EmailProvider` interface | Provider swappable by env var, as required |
| Scheduling | **Vercel Cron** → one daily route for overdue reminders | No queue infrastructure |
| Testing | **Vitest** (unit/integration) + **Playwright** (e2e) + **axe-core** (a11y) | |
| Hosting | **Vercel** | Required |
| Repo | **GitHub**, private | Required |

### 2.1 Recommended change from the brief: Neon instead of Supabase

The brief says "PostgreSQL, preferably Supabase". I recommend **Neon** and want your explicit sign-off, because the difference is operational, not cosmetic:

- **Supabase free projects pause after a period of inactivity and need a manual restore from the dashboard.** A community library that gets no traffic for a week is exactly the profile that trips this. A librarian opening the app to a dead database on a Saturday morning is a real failure mode.
- **Neon free projects auto-suspend and auto-resume on the next connection** — a cold start, not an outage.
- We are not using any Supabase feature that would justify the risk: no Row Level Security (the browser never touches the database — all access is server-side through Prisma), no Supabase Auth (see §10), no Realtime. We would be using Supabase purely as hosted Postgres plus a file bucket.
- File storage moves to **Vercel Blob**, which we already have by virtue of deploying on Vercel.

Either choice is a `DATABASE_URL` swap — nothing in the application code differs. **Verify current free-tier terms for both at setup time**; plan terms change.

**Rejected alternatives:** Supabase Auth (forces email-as-identity — children have no email, see §11); Clerk/Auth0 (cost at growth, external dependency for a free community project); Drizzle (Prisma's migration ergonomics matter more here than Drizzle's edge story); a separate Express/Nest backend (unnecessary for this size).

---

## 3. System Architecture

```
                    ┌─────────────────────────────────────────┐
   Browser          │  Vercel Edge — middleware               │
   (child /         │  • session cookie check                 │
    librarian /     │  • route-group gate (/reader /desk /admin)
    admin /         │  • security headers + CSP nonce         │
    parent)         └──────────────────┬──────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │  Next.js App Router (Node runtime)      │
                    │                                         │
                    │  app/          route groups + RSC pages │
                    │  components/   design system + features │
                    │      ── may only call ──►               │
                    │  server/actions/   thin: parse → call   │
                    │      ── may only call ──►               │
                    │  server/services/  ALL business rules   │
                    │      • authorize()  ← every entry point │
                    │      • audit()      ← every mutation    │
                    │      ── may only call ──►               │
                    │  server/repositories/  library-scoped   │
                    │      ── may only call ──►               │
                    │  server/db (Prisma)                     │
                    │                                         │
                    │  server/lib/  email · storage · tokens  │
                    │               settings · ratelimit      │
                    └───┬───────────────┬──────────────┬──────┘
                        │               │              │
                  ┌─────▼─────┐  ┌──────▼─────┐  ┌─────▼──────┐
                  │  Neon     │  │ Vercel Blob│  │  Resend    │
                  │  Postgres │  │ private +  │  │  (SMTP     │
                  │           │  │ public     │  │   fallback)│
                  └───────────┘  └────────────┘  └────────────┘
                        ▲
                  ┌─────┴──────────────┐
                  │ Vercel Cron 03:00Z │  daily: overdue sweep,
                  │ (08:30 IST)        │  reminders, token GC
                  └────────────────────┘
```

**The one rule that keeps this maintainable:** a component or action may never touch Prisma directly. Business rules live in exactly one place — `server/services/`. Enforced by an ESLint `no-restricted-imports` boundary rule, so it fails CI rather than degrading quietly.

**Three service invariants**, applied at the top of every service function:

1. `authorize(actor, permission, resource)` — throws before any work.
2. `scope(libraryId)` — no repository call runs unscoped.
3. `audit(...)` — every state change writes a log row in the same transaction as the change.

---

## 4. Roles and Permissions Matrix

Roles are seed rows. Permissions are string keys stored in `permission`; roles map to them via `role_permission`. Adding **Junior Librarian** later = one seed row + a mapping list. No code change.

### 4.1 Permission catalogue (v1)

`registration.view` · `registration.review` · `member.view` · `member.view_contact` · `member.create` · `member.edit` · `member.suspend` · `member.reset_password` · `book.view` · `book.create` · `book.edit` · `book.archive` · `book.delete` · `donation.view` · `donation.record` · `donation.view_private` · `loan.issue` · `loan.return` · `loan.renew` · `loan.override_rules` · `loan.mark_lost` · `report.view` · `announcement.manage` · `settings.view` · `settings.edit` · `branding.edit` · `user.manage_staff` · `role.manage` · `audit.view` · `email.configure`

### 4.2 Matrix

| Permission | Super Admin | Librarian | Junior Librarian *(seeded, disabled in v1)* | Member (Child) | Guardian |
|---|:--:|:--:|:--:|:--:|:--:|
| registration.view | ✅ | ✅ | — | — | — |
| registration.review | ✅ | ✅ | — | — | — |
| member.view | ✅ | ✅ | name + photo only | own only | own children |
| member.view_contact *(parent phone/email)* | ✅ | ✅ | ❌ | ❌ | own only |
| member.create / edit | ✅ | ✅ | ❌ | ❌ | ❌ |
| member.suspend | ✅ | ✅ | ❌ | ❌ | ❌ |
| member.reset_password *(trigger email — never view)* | ✅ | ✅ | ❌ | ❌ | ❌ |
| book.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| book.create / edit | ✅ | ✅ | ❌ | ❌ | ❌ |
| book.archive | ✅ | ✅ | ❌ | ❌ | ❌ |
| book.delete *(hard delete)* | ✅ | ❌ | ❌ | ❌ | ❌ |
| donation.record | ✅ | ✅ | ❌ | ❌ | ❌ |
| donation.view_private *(donor who chose anonymous)* | ✅ | ✅ | ❌ | ❌ | ❌ |
| loan.issue / return | ✅ | ✅ | ✅ | ❌ | ❌ |
| loan.renew | ✅ | ✅ | ✅ | request only | ❌ |
| loan.override_rules | ✅ | ✅ | ❌ | ❌ | ❌ |
| loan.mark_lost | ✅ | ✅ | ❌ | ❌ | ❌ |
| report.view | ✅ | ✅ (basic) | ❌ | ❌ | ❌ |
| announcement.manage | ✅ | ✅ | ❌ | ❌ | ❌ |
| settings.view / edit | ✅ | ❌ | ❌ | ❌ | ❌ |
| branding.edit | ✅ | ❌ | ❌ | ❌ | ❌ |
| user.manage_staff | ✅ | ❌ | ❌ | ❌ | ❌ |
| role.manage | ✅ | ❌ | ❌ | ❌ | ❌ |
| audit.view | ✅ | ❌ | ❌ | ❌ | ❌ |

**Nobody, at any level, can view a password.** No permission exists for it — the hash is never selected outside the auth service, and there is no plaintext anywhere in the system.

**Ownership rules override permissions** for members: a child holding `book.view` still only ever resolves *their own* loans, because the service takes `memberUserId` from the session, never from the request.

---

## 5. User Workflows

### 5.1 Parent registers a child

```
Parent → /join
  ├─ "Let's create your library account!"  (single friendly form)
  ├─ child name · date of birth · apartment
  ├─ parent name · mobile · email
  ├─ photo upload OR pick an avatar (12 friendly SVG characters)
  ├─ consent checkbox: guardian consent for a child's account (§17.4)
  └─ submit
        │
        ├─ Zod validation + honeypot + rate limit (IP hash, 5/hour)
        ├─ age checked against settings.ageMin/ageMax  → friendly rejection if outside
        ├─ duplicate check: same child name + apartment already pending/active → "we already have this"
        ├─ registration_request row, status = PENDING
        ├─ email → parent: "We got it! Your librarian will review this soon."
        └─ email → librarians: "1 new reader is waiting"
```

### 5.2 Librarian approves

```
Librarian → /desk/registrations  ("New Library Members")
  ├─ card per request: photo/avatar, name, age, apartment, parent, submitted date
  ├─ [View details] [Approve] [Needs a chat] (= UNDER_REVIEW, internal note)
  └─ Approve
        ├─ creates User(kind=MEMBER, status=INVITED, mustSetPassword=true)
        ├─ creates MemberProfile with member_code = <PREFIX>-R0042
        ├─ creates/links Guardian by email, records consent
        ├─ mints single-use ACTIVATION token (32-byte random, stored as SHA-256 hash, 7-day expiry)
        ├─ email → parent: "Aarav's library account is ready — set a password"
        └─ audit: registration.approved
```

Reject requires a reason; the parent email is soft ("we'd love to chat with you at the library") and never states an internal reason verbatim.

### 5.3 Child first login

```
Parent opens activation link → /activate/<token>
  ├─ token: hash lookup, unexpired, unconsumed, single use
  ├─ screen shows the child's own library card: photo, name, member code
  ├─ "Pick a secret word only you know" — password + confirm, big fields, show/hide toggle
  ├─ password rules for members: min 6 chars, blocked against a common-password list, no
  │  complexity theatre (a 6-year-old cannot type A1!x); protected by throttling + lockout
  ├─ sets hash, status ACTIVE, consumes token, revokes any other tokens for that user
  └─ lands on /reader — "Welcome to Mana Jardin Children's Library 📚"
```

### 5.4 Issue a book (the desk workflow that must be fast)

```
Librarian → /desk  → [Give a book]
  1. Who?   type 3 letters or member code → card list with photos → pick
  2. Which? type title / author / copy code → result list with availability → pick
  3. Confirm screen:  "Aarav (P15) → 'The Gruffalo' · back by Sat 30 Aug"
  4. [Give the book]
        ├─ service re-checks, inside one transaction:
        │    • copy.status = AVAILABLE
        │    • member.status = ACTIVE and not suspended
        │    • member active loans < settings.maxActiveLoans
        │    • member has no loan overdue beyond settings.blockOnOverdueDays (configurable, 0 = never block)
        │    • DB partial unique index guarantees one ACTIVE loan per copy even under a double-click
        ├─ loan row + loan_event(ISSUE) + copy.status = BORROWED
        ├─ due_at = today(TZ) + settings.borrowingPeriodDays, normalised to end-of-day in library TZ
        └─ audit: loan.issued
```

Return is one step: find the copy → the screen shows who has it → **[It's back!]** → available.
Renew: **[Keep it longer]** → checks `renewalCount < settings.maxRenewals` → extends by `settings.renewalPeriodDays`.

*(Built in Phase 3, 17 August 2026. Three refinements to the sketch above, all
recorded in [`CIRCULATION.md`](CIRCULATION.md): the reader's row is locked
before the copy's, which is what makes the loan-limit check safe under
concurrency and not merely the copy index; `settings.blockOnOverdueDays` is
**not** wired to issuing — an overdue book blocks renewal, not borrowing, and the
column stands unused; and a deferred constraint trigger, not the service, is what
guarantees `copy.status = BORROWED` and an ACTIVE loan agree. Renewal extends
from the current due date rather than from today.)*

### 5.5 Child's day-to-day

Log in → **My Books** (what I have, when it goes back) · **Find a Book** (search + browse) · **Books Due Soon** · **New Books** · **My Reading History** · **Thank You, Book Donors**.
Child can tap **"Ask to keep it longer"** on a loan → raises a renewal request the librarian sees on the desk dashboard. Children never mutate loans directly in v1.

### 5.6 Donation intake

```
Book arrives → Librarian → /desk/books/new
  ├─ human decision: is this suitable for our readers?  (system never auto-judges)
  ├─ title details (ISBN field present; auto-lookup is a future enhancement, manual in v1)
  ├─ if the title already exists → "We have this! Add another copy" → creates copy #2
  ├─ copy: condition · shelf · acquisition type = RESIDENT_DONATION
  ├─ donor: name · apartment · display consent  [Show my name] [Apartment only] [Anonymous]
  ├─ copy_code auto-assigned: MJCL-0051  (prefix from settings, sequence per library)
  └─ status AVAILABLE → appears on the shelf and in the catalogue
```

---

## 6. Database Architecture

PostgreSQL. `snake_case` tables, UUIDv7 primary keys (time-sortable), `timestamptz` everywhere, business rules never encoded as magic numbers in columns.

### 6.1 Tables

**Tenancy & configuration**

| Table | Key columns |
|---|---|
| `community` | id, name, slug, address_line, city, country, created_at |
| `library` | id, community_id→community, name, slug, description, created_at |
| `library_settings` | library_id PK→library, age_min, age_max, borrowing_period_days, max_active_loans, max_renewals, renewal_period_days, renewal_blocked_when_reserved, block_on_overdue_days, overdue_reminder_offsets int[], copy_code_prefix, copy_code_padding, catalogue_visibility, donor_display_default, logo_url, favicon_url, primary_color, secondary_color, welcome_message, contact_email, contact_phone, rules_markdown, donation_policy_markdown, timezone, date_format, email_enabled, overdue_reminders_enabled, updated_at, updated_by |

**Identity & access**

| Table | Key columns |
|---|---|
| `app_user` | id, library_id, kind (STAFF·MEMBER·GUARDIAN), display_name, email (citext, nullable), username (nullable), password_hash (nullable), status (INVITED·ACTIVE·SUSPENDED·DEACTIVATED), must_set_password, last_login_at, failed_login_count, locked_until, created_at, created_by |
| `role` | id, library_id (null = platform role), key, name, is_system |
| `permission` | key PK, description, category |
| `role_permission` | role_id, permission_key |
| `user_role` | user_id, role_id, granted_by, granted_at |
| `member_profile` | user_id PK→app_user, library_id, member_code, date_of_birth, avatar_key, photo_object_key, apartment, joined_at, staff_notes |
| `guardian` | id, library_id, full_name, email (citext), phone, apartment, created_at |
| `guardian_member` | guardian_id, member_user_id, relationship, is_primary, consent_version, consent_at |
| `registration_request` | id, library_id, child_name, child_dob, apartment, guardian_name, guardian_email, guardian_phone, avatar_key, photo_object_key, status (PENDING·UNDER_REVIEW·APPROVED·REJECTED), submitted_at, reviewed_by, reviewed_at, review_note, created_member_user_id, consent_version, consent_at, ip_hash |

**Catalogue**

| Table | Key columns |
|---|---|
| `category` | id, library_id, name, slug, icon, sort_order, is_active |
| `book_title` | id, library_id, title, authors text[], publisher, isbn13, isbn10, language, description, cover_object_key, age_min, age_max, category_id, created_at, created_by |
| `book_copy` | id, library_id, title_id→book_title, copy_code, status (AVAILABLE·BORROWED·RESERVED·LOST·DAMAGED·ARCHIVED), condition (NEW·GOOD·FAIR·WORN), shelf_location, acquisition_type (RESIDENT_DONATION·PURCHASE·TRANSFER), acquired_at, archived_at, notes |
| `donation` | id, library_id, copy_id UNIQUE→book_copy, donor_name, donor_apartment, donor_user_id (nullable), display_consent (NAMED·APARTMENT_ONLY·ANONYMOUS), donated_at, recorded_by, note |

**Circulation**

| Table | Key columns |
|---|---|
| `loan` | id, library_id, copy_id→book_copy, member_user_id→app_user, issued_at, issued_by, due_at, returned_at, returned_by, renewal_count, status (ACTIVE·RETURNED·LOST·WRITTEN_OFF) |
| `loan_event` | id, loan_id, type (ISSUE·RENEW·RETURN·MARK_LOST·MARK_DAMAGED·ADJUST_DUE), occurred_at, actor_user_id, previous_due_at, new_due_at, note |
| `renewal_request` | id, loan_id, requested_by, requested_at, status (PENDING·APPROVED·DECLINED), decided_by, decided_at |

**Platform**

| Table | Key columns |
|---|---|
| `auth_token` | id, user_id, type (ACTIVATION·PASSWORD_RESET), token_hash, expires_at, consumed_at, created_by, created_at |
| `session` | id, user_id, session_token_hash, expires_at, created_at, last_seen_at, user_agent_hash |
| `login_attempt` | id, library_id, identifier_hash, ip_hash, succeeded, attempted_at |
| `audit_log` | id, library_id, actor_user_id, actor_label, action, entity_type, entity_id, metadata jsonb, ip_hash, occurred_at |
| `announcement` | id, library_id, title, body_markdown, audience (ALL·MEMBERS·STAFF), published_at, expires_at, created_by |
| `email_event` | id, library_id, recipient, template, subject, status (QUEUED·SENT·FAILED), provider_message_id, error, related_entity_type, related_entity_id, created_at, sent_at |

### 6.2 Constraints that carry real weight

```sql
-- a copy can be on loan to exactly one reader at a time, enforced by the database
CREATE UNIQUE INDEX one_active_loan_per_copy
  ON loan (copy_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_copy_code   ON book_copy (library_id, copy_code);
CREATE UNIQUE INDEX uq_member_code ON member_profile (library_id, member_code);
CREATE UNIQUE INDEX uq_user_email  ON app_user (library_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_username    ON app_user (library_id, username) WHERE username IS NOT NULL;

ALTER TABLE loan ADD CONSTRAINT due_after_issue CHECK (due_at > issued_at);
ALTER TABLE library_settings ADD CONSTRAINT sane_ages CHECK (age_min >= 0 AND age_max > age_min);

-- hot paths
CREATE INDEX ON loan (library_id, status, due_at);
CREATE INDEX ON loan (member_user_id, status);
CREATE INDEX ON book_copy (library_id, status);
CREATE INDEX ON registration_request (library_id, status, submitted_at);
CREATE INDEX ON book_title USING gin (to_tsvector('simple', title || ' ' || array_to_string(authors,' ')));
```

Overdue is **derived** (`status = 'ACTIVE' AND due_at < now()`), not stored — no nightly job can leave it stale. The daily cron only *sends reminders*; it never defines truth.

---

## 7. Entity Relationships

```
community ─1:N─ library ─1:1─ library_settings
                   │
                   ├─1:N─ app_user ─1:1─ member_profile ─N:M─ guardian
                   │         └─N:M─ role ─N:M─ permission
                   │
                   ├─1:N─ registration_request ──(on approve)──► app_user
                   │
                   ├─1:N─ category ─1:N─ book_title ─1:N─ book_copy ─1:1─ donation
                   │                                        │
                   │                                        └─1:N─ loan ─1:N─ loan_event
                   │                                                  └─1:N─ renewal_request
                   │                                        (loan ─N:1─ app_user as borrower)
                   │
                   └─1:N─ announcement · audit_log · email_event
```

Three separations that exist purely so the future is cheap:

- **`book_title` vs `book_copy`** — three copies of *The Gruffalo* are one catalogue entry and three shelf items with their own IDs, conditions and histories. Retrofitting this later means rewriting every circulation query.
- **`app_user` vs `member_profile` vs `guardian`** — a guardian is not a borrower; a member's login identity is not their library card data. Keeps parent contact details behind a permission that most staff screens never request.
- **`loan` vs `loan_event`** — the loan is current state; events are the immutable story. Renewals, due-date adjustments and lost-book handling all append rather than overwrite.

---

## 8. Application Structure

```
community-library/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
│       ├── platform.ts        # permissions, system roles, avatars — ALL environments
│       ├── library.ts         # community + library + settings + categories (prompted values)
│       └── demo.ts            # sample books/members — DEV ONLY, refuses NODE_ENV=production
├── src/
│   ├── app/
│   │   ├── (public)/          # /  /join  /donors  /rules  /login  /activate  /reset
│   │   ├── (reader)/reader/   # child app — books, search, my-books, history, favourites
│   │   ├── (desk)/desk/       # librarian — dashboard, issue, return, registrations, books, members
│   │   ├── (admin)/admin/     # super admin — settings, branding, staff, roles, reports, audit
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── cron/daily/route.ts        # CRON_SECRET-guarded
│   │   │   ├── uploads/route.ts           # validated, authenticated uploads
│   │   │   └── media/[key]/route.ts       # signed access to private child photos
│   │   ├── layout.tsx         # injects branding CSS variables from settings
│   │   ├── error.tsx  not-found.tsx  global-error.tsx
│   │   └── manifest.ts  robots.ts  icon.tsx
│   ├── components/
│   │   ├── ui/                # Button Card Modal FormField DataTable StatusBadge
│   │   │                      # EmptyState LoadingState ErrorState Avatar SearchBar …
│   │   ├── library/           # BookCard BookCover AvailabilityBadge DueDatePill
│   │   │                      # LibraryLogo DonorCredit MemberCard DashboardCard
│   │   └── layout/            # ReaderShell DeskShell AdminShell Header Footer Nav
│   ├── server/
│   │   ├── auth/              # authjs config, callbacks, password policy, throttle
│   │   ├── actions/           # server actions: parse with zod → call service → revalidate
│   │   ├── services/          # registration · member · catalogue · donation · circulation
│   │   │                      # settings · report · announcement · audit · notification
│   │   ├── repositories/      # library-scoped Prisma access, one file per aggregate
│   │   ├── lib/               # email/ storage/ tokens/ dates/ ids/ ratelimit/ permissions/
│   │   └── db.ts
│   ├── lib/                   # isomorphic: zod schemas, formatters, constants, types
│   ├── emails/                # React Email templates
│   └── middleware.ts
├── public/avatars/            # 12 friendly SVG characters
├── tests/                     # unit/ integration/ e2e/
├── docs/                      # README ARCHITECTURE SETUP DEPLOYMENT SECURITY …
├── .env.example
└── vercel.json                # cron schedule
```

---

## 9. API Architecture

**Server Actions for everything the UI does.** Mutations are form submissions from React Server Components — no REST layer to duplicate, no client-side fetch of child data, no API keys in the browser. Each action is thin:

```
action = authenticate() → zod.parse(formData) → service.doThing(actor, input) → revalidatePath()
```

**Route Handlers only where an HTTP endpoint is genuinely required:**

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/[...nextauth]` | * | — | Auth.js |
| `/api/cron/daily` | GET | `CRON_SECRET` bearer | overdue reminders, due-soon nudges, expired-token GC |
| `/api/uploads` | POST | session + `permission` | validated photo/cover upload → Blob |
| `/api/media/[key]` | GET | session + ownership | signed redirect for private child photos |
| `/api/health` | GET | — | DB ping for uptime monitoring |

**Error contract:** services throw typed errors (`NotAuthorizedError`, `RuleViolationError`, `NotFoundError`, `ConflictError`) carrying both an internal message (logged, with request id) and a child-safe message (shown). No stack traces, SQL, or entity IDs ever reach the browser.

**Future REST/mobile:** if a native app is ever needed, `server/services` is already the API — a `/api/v1` layer wraps it without touching business logic.

---

## 10. Authentication Architecture

**Auth.js v5, Credentials provider, database sessions, Prisma adapter.**

Database sessions rather than JWTs, deliberately: suspending a child or a departing librarian must log them out *now*, not in 30 days. `DELETE FROM session WHERE user_id = ...` is instant and auditable. The cost — one indexed query per request — is irrelevant at this scale.

| Concern | Decision |
|---|---|
| Identity | Staff: email. **Members: `member_code` OR a simple username** (see §25 open question 1) |
| Hashing | argon2id, `m=19456,t=2,p=1` |
| Session cookie | `httpOnly`, `secure`, `sameSite=lax`, `__Host-` prefix |
| Session lifetime | Staff 8h idle / 12h absolute · Members 7d rolling · **[End session] button** prominent on shared/kiosk devices |
| Activation | 32 random bytes, base64url, **SHA-256 hash stored**, single-use, 7-day expiry, invalidates siblings on use |
| Password reset | Same token mechanism, 1-hour expiry, **always the same response** whether or not the account exists |
| Throttling | Per-identifier: 5 fails → 15-min lock, escalating. Per-IP: 20 fails/hour. Backed by `login_attempt` — no Redis dependency |
| Login errors | Always "That didn't work. Check the spelling and try again." — never "no such user" |
| Password change | Requires current password; revokes all *other* sessions |
| Never | No plaintext storage, no plaintext email, no password visible to any role, no password in logs or audit metadata |

**Member password policy (needs your sign-off, §25):** minimum 6 characters, checked against a common-password blocklist, no character-class requirements. Complexity rules are counterproductive for a 6-year-old and push families toward writing passwords on the shelf. Compensating controls: strict lockout, short lived sessions on shared devices, and the fact that the worst-case compromise is seeing which picture books someone borrowed. **Staff accounts are held to a much higher bar:** minimum 12 characters, zxcvbn strength score ≥ 3.

---

## 11. Registration & Approval Architecture

**No open signup.** `/join` creates a *request*, never an account. Only a librarian action creates a `app_user` row.

Status machine — the only legal transitions:

```
PENDING ──► UNDER_REVIEW ──► APPROVED ──► (member INVITED ──► ACTIVE)
   │              │                                  │
   └──► REJECTED ◄┘                                  ├──► SUSPENDED ◄──► ACTIVE
                                                     └──► DEACTIVATED
```

Enforced in the service as an explicit transition table, not scattered `if` statements.

**Abuse controls on the public form:** IP-hash rate limit (5/hour), hidden honeypot field, minimum time-on-form, size-and-type-validated upload, and no information leakage in responses (a duplicate submission gets the same friendly acknowledgement as a new one).

**Why a child cannot own the email identity:** children aged 5–14 mostly have no email address, and requiring one would exclude families or push them to share a parent's inbox as a login. So the parent's email is the **recovery and notification channel**, stored on `guardian`; the child's **login identity is their library card code or a chosen username**. This is the single most consequential UX decision in the whole system and is why Supabase Auth (email-centric) was rejected.

---

## 12. Book Catalogue Design

**Two-level model, one accession flow.**

- `book_title` — bibliographic truth: title, authors, publisher, ISBN, language, description, cover, age range, category.
- `book_copy` — a physical object on a shelf: `MJCL-0001`, condition, location, status, its own donation record and loan history.

**ID generation:** `{settings.copyCodePrefix}-{sequence padded to settings.copyCodePadding}` → `MJCL-0001`, or `LIB-0001` for the next community. *(Superseded: the separator is not fixed — a prefix that already ends in punctuation is treated as complete, and the prefix now carries a kind letter, so copies read `MJCL-B0001` against cards' `MJCL-R0001` (`LIB-B` / `LIB-R` by default). See `DATABASE.md` §4 and `IDENTITY.md` §3.)* Sequence is per-library, allocated inside the creation transaction with a row lock so two librarians adding books at the same desk cannot collide. Codes are never reused, even after archiving — a code is a permanent physical label.

**Duplicate handling:** ISBN match (when present) or normalised title+author match prompts *"We already have this book — add another copy?"* rather than silently creating a parallel title.

**Categories are data** (`category` table, seeded with Story Books, Comics, Adventure, Science, General Knowledge, Animals, Space, History, Biography, Fantasy, Educational, Activity Books, Young Readers) — renameable and extendable from admin, each with an icon for the child UI.

**Search:** Postgres full-text over title + authors, plus trigram similarity for the misspellings that are guaranteed with this audience ("grufalo" → *The Gruffalo*). No external search service.

**Catalogue visibility** is a setting (`PUBLIC` | `MEMBER_ONLY`), defaulting to `MEMBER_ONLY` for this deployment (see §25.3 and ADR-007).

**QR readiness:** `copy_code` is already the scan payload. A future scanner screen resolves `copy_code → copy → issue/return`, requiring zero schema change. v1 accepts typed codes.

---

## 13. Borrow / Return Architecture

Every rule reads from settings — no number is compiled in:

| Rule | Setting | Mana Jardin default |
|---|---|---|
| Loan length | `borrowing_period_days` | 14 |
| Books at once | `max_active_loans` | 2 |
| Renewals allowed | `max_renewals` | 1 |
| Renewal length | `renewal_period_days` | 7 |
| Block if overdue | `block_on_overdue_days` | 7 (0 disables) |
| Reminder schedule | `overdue_reminder_offsets` | `[-2, 0, 3, 7]` days relative to due |

**Date handling.** Everything stored `timestamptz` in UTC. All business dates computed in `settings.timezone` (Asia/Kolkata) — never the browser's. `due_at` is normalised to 23:59:59 local so a book issued at 9am and one at 6pm are both due at end of day. Browser timezone influences nothing but incidental display.

**Concurrency.** Issue runs in a single transaction: check → insert loan → update copy status. The partial unique index is the backstop — a double-tapped button raises a constraint violation, which the service translates into *"Someone just borrowed this one!"* rather than a 500.

**Language.** `"You have this book until Sat 30 August"` · `"Oops! This book is ready to come home 🏠"` · never *"OVERDUE — PENALTY APPLIES"*. There are no fines in this library and the copy must never imply otherwise.

**Lost/damaged** are librarian actions that close the loan, set the copy status, and write a `loan_event` — no automated punishment, no charges.

---

## 14. Donor Architecture

`donation` is 1:1 with a **copy**, not a title — the community gave *this book*, and if a second family donates the same story, both are acknowledged.

**Consent is per donation**, captured at intake: `NAMED` (name + apartment) · `APARTMENT_ONLY` · `ANONYMOUS`. Rendering respects it everywhere:

> 📚 This book was generously donated by **Mrinal** from **P15**.
> 📚 This book was generously donated by a family in **P15**.
> 📚 This book was generously donated by a family in our community.

**"Thank You, Book Donors"** page: an unordered, alphabetical wall of contributors — no counts, no ranking, no "top donor", no leaderboard, ever. This is a product constraint, written into the page component and covered by a test that fails if any sort-by-count logic appears.

> *"Every book on our shelf is a gift to the community. Thank you to all the families who have shared books with our young readers."*

**Membership never depends on donation.** No schema field links a member to a donation requirement; no UI copy hints at one. `acquisition_type` distinguishes `RESIDENT_DONATION` from `PURCHASE` so the library can hold both without implying a quid pro quo.

---

## 15. Notification Architecture

One `NotificationService` with pluggable channels. v1 registers exactly one channel — email — behind an interface that WhatsApp/push/in-app can join later without touching call sites.

```
service → notify(event, recipients, payload)
            └─► channels[]  ── EmailChannel (v1)
                            ── InAppChannel  (phase 2)
                            ── WhatsAppChannel (future, on request)
```

**Email provider abstraction:** `EmailProvider { send(message): Promise<Result> }` with `ResendProvider`, `SmtpProvider` and `ConsoleProvider` (dev). Selected by `EMAIL_PROVIDER`. Zero provider references outside `server/lib/email/`.

**v1 templates** (React Email, branded from settings): registration received · registration approved + activation · registration not approved · password reset · due soon · overdue nudge · account suspended · new-registration alert to librarians.

Every send writes an `email_event` row, so "did the parent get the link?" is answerable without leaving the admin UI. Failures are logged and surfaced, never swallowed. **Children's email addresses are not collected; all mail goes to the guardian.**

The daily cron at **08:30 IST** does one pass: due-soon nudges, overdue nudges on the configured offsets, expired token cleanup. Idempotent — a re-run on the same day sends nothing twice (guarded by `email_event` lookup).

---

## 16. Security Architecture

| Area | Control |
|---|---|
| Authorization | `authorize()` at the top of every service function; deny-by-default; ownership checks take IDs from the session, never the request |
| Route protection | Middleware gates route groups; the real check is always server-side in the service |
| Input | Zod on every boundary, including server action FormData |
| SQL injection | Prisma parameterised queries; no raw SQL except a handful of reviewed, parameterised report queries |
| XSS | React escaping; markdown fields (rules, announcements) sanitised through `rehype-sanitize` with a strict allowlist |
| CSRF | Auth.js CSRF token + `sameSite=lax` cookies + Next.js server action origin verification |
| Headers | CSP with per-request nonce (no `unsafe-inline`), HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geo |
| Uploads | Extension **and** magic-byte sniffing, ≤5 MB, images only, re-encoded server-side (strips EXIF including GPS), random storage key — original filename never used as a path |
| Private media | Child photos in a **private** Blob store, served only via `/api/media/[key]` after an ownership/permission check, short-lived signed URLs |
| Rate limiting | Login, registration, password reset, uploads — DB-backed counters, no new infrastructure |
| Secrets | Vercel environment variables only; `.env` gitignored; `.env.example` has placeholders only; a `gitleaks` CI step blocks accidental commits |
| Audit | Every mutation logged in the same transaction as the change; passwords, tokens and hashes never appear in metadata |
| Dependencies | Dependabot + `npm audit` in CI |
| Data minimisation | We collect child name, DOB, apartment, optional photo — nothing else. No analytics, no third-party scripts, no tracking pixels on any child-facing page |
| Backups | **Verified 2026-08-17: Neon free-tier point-in-time restore is 6 hours only.** Too thin to rely on, so a scheduled `pg_dump` you control is REQUIRED, not optional — see `docs/OPERATIONS.md` |

**Deliberately not built:** custom crypto of any kind. Tokens are `crypto.randomBytes`, hashing is argon2id, sessions are Auth.js.

---

## 17. Child-Friendly UX Strategy

### 17.1 Design language — "The Reading Corner"

Not a SaaS dashboard, not a corporate portal: a warm paper-and-crayon world. Cream ground rather than clinical white; rounded cards with soft, real elevation; a rounded, highly legible display face for headings (Baloo 2 / Fredoka) paired with a workhorse sans for body; illustrated spot art on empty states; book spines and shelf motifs as structural elements, not decoration sprinkled on top.

### 17.2 Rules for the reader app

- **Never more than 6 choices on a screen.** Four is better.
- **Minimum 18px body, 24px+ for actions.** Touch targets ≥ 56px — smaller hands, less precision.
- **Icon + word on every action**, because a 5-year-old reads the icon and a 9-year-old reads the word.
- **No tables anywhere in the reader app.** Cards only.
- **Book covers do the navigating** — visual recognition beats text for early readers.
- **Every state is designed**: loading, empty, error, success. Empty states are invitations, not dead ends.
- **Confirm anything destructive, and make undo the easy path.**

### 17.3 Voice

| Instead of | We say |
|---|---|
| Inventory / Acquisition | Books / New Books |
| Circulation | Books on Loan |
| Patron / Borrower | Reader |
| Due date | "Back by Saturday 30 August" |
| Overdue | "Ready to come home 🏠" |
| HTTP 500 | "Oops! Something went wrong. Please ask your librarian for help." |
| Authentication failed | "That didn't work. Let's try again." |

The desk and admin apps use professional terminology and information-dense tables — different audience, different tool.

### 17.4 Accessibility (built in, not bolted on)

WCAG 2.1 AA as the floor: measured contrast ≥ 4.5:1 for body text and ≥ 3:1 for large text and UI boundaries (child-friendly pastels fail this constantly — **every token gets measured, not eyeballed**); full keyboard operation with visible focus rings; semantic landmarks and one `h1` per page; alt text on every cover and avatar; `prefers-reduced-motion` honoured; forms with real `<label>`s, `aria-describedby` errors and inline validation in plain words. `axe-core` runs in CI on every key page and fails the build on violations.

### 17.5 Privacy in the interface

A child sees their own name, their own books, their own history — nothing about any other child. There is no member directory in the reader app. No public page connects a book to a borrower. Parent phone and email never render on a child-facing screen, and are behind `member.view_contact` even for staff.

---

## 18. Configuration Architecture

```
Environment variables  →  infrastructure only (DB URL, secrets, provider keys)
library_settings row   →  everything a librarian or admin might ever want to change
seed data              →  categories, avatars, roles, permissions
code constants         →  only genuinely invariant things (status enum values)
```

One accessor, cached per request:

```ts
const settings = await getLibrarySettings();   // typed, zod-validated, request-cached
if (age > settings.ageMax) …
const dueAt = addDays(today(settings.timezone), settings.borrowingPeriodDays);
<h1>{settings.libraryName}</h1>
```

**Branding is applied as CSS custom properties** injected in the root layout from settings, so changing the primary colour in admin restyles the app with no deploy. Logo and favicon are uploaded objects referenced by URL.

An ESLint rule bans the literal strings `"Mana Jardin"` and `"MJCL"` outside `prisma/seed/` — the guarantee that the platform stays generic is mechanical, not a matter of discipline.

---

## 19. Deployment Architecture (GitHub + Vercel)

```
GitHub (private: msrx-community-library)
  ├─ main ──────────► Vercel Production ──► library.msrx.co.in
  ├─ PR branches ───► Vercel Preview  + Neon branch database
  └─ CI: typecheck · lint · unit · integration (Neon branch) · axe · gitleaks
```

**Setup sequence** (full command-level detail goes in `docs/DEPLOYMENT.md`):

1. Create the private GitHub repo under your account; push `main`.
2. Create the Neon project (region: Singapore / `ap-southeast-1`, nearest to Bengaluru). Copy the **pooled** connection string → `DATABASE_URL`, and the **direct** one → `DIRECT_URL` (Prisma migrations need the unpooled endpoint).
3. Import the repo into Vercel (`MrinalSinghRaja@gmail.com` account — confirm `vercel whoami` first; your Chinaki account must not be used here).
4. Set environment variables in Vercel for Production and Preview (§20).
5. `npx prisma migrate deploy` runs in the build command; `prisma/seed/platform.ts` runs idempotently after.
6. Create the first Super Admin (§21 below) — interactive, never a default password.
7. Add the domain in Vercel → **Settings → Domains → `library.msrx.co.in`**.
8. At your DNS provider for `msrx.co.in`, add: `CNAME  library  →  cname.vercel-dns.com` (Vercel shows the exact target; if the provider forces an A record, use the IP Vercel gives you). TTL 600. **Do not touch existing records for `www`, `weather`, `planner`, etc.**
9. Wait for propagation; Vercel provisions the TLS certificate automatically. Verify HTTPS and that HTTP redirects.
10. Configure Resend: add and verify a sending domain (`msrx.co.in` or a `mail.` subdomain) with the SPF/DKIM records it specifies — without this, activation emails land in spam, which breaks the entire onboarding flow.
11. Run the production smoke checklist (§26).

**Cron:** `vercel.json` schedules `/api/cron/daily`. Note that Vercel's Hobby plan restricts cron frequency (historically once per day) — our design needs exactly one daily run, so this fits, but **verify the current limit at setup**.

**Rollback:** Vercel instant rollback for code. Database migrations are additive-only by policy (no destructive change ships without an explicit, reviewed two-step plan).

---

## 20. Environment Variables

```bash
# ---- Database (Neon) ----
DATABASE_URL=              # pooled connection, used at runtime
DIRECT_URL=                # direct connection, used by prisma migrate

# ---- Auth ----
AUTH_SECRET=               # openssl rand -base64 32
AUTH_URL=                  # https://library.msrx.co.in
AUTH_TRUST_HOST=true

# ---- App ----
NEXT_PUBLIC_APP_URL=       # https://library.msrx.co.in
APP_TIMEZONE=Asia/Kolkata  # bootstrap default; library_settings.timezone wins after setup

# ---- Email ----
EMAIL_PROVIDER=            # resend | smtp | console
RESEND_API_KEY=            # if provider=resend
SMTP_HOST=                 # if provider=smtp
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=true
EMAIL_FROM=                # "Mana Jardin Children's Library <library@msrx.co.in>"
EMAIL_REPLY_TO=

# ---- Storage (Vercel Blob) ----
BLOB_READ_WRITE_TOKEN=     # auto-injected by Vercel when the store is linked

# ---- Jobs ----
CRON_SECRET=               # bearer token guarding /api/cron/daily

# ---- Optional ----
SENTRY_DSN=                # error reporting; omit to disable
```

`.env.example` ships with these keys and placeholder values only. No real secret ever enters the repository; a `gitleaks` CI step enforces it.

---

## 21. Initial Super Admin (secure bootstrap)

No default credentials exist anywhere in the codebase. Two supported paths, both documented in `docs/SETUP.md`:

1. **CLI (preferred):** `npm run create-admin` — prompts for name, email and password on the terminal (never echoed, never logged), validates strength, writes the user with `SUPER_ADMIN` role, writes an audit row. Run locally against the production `DIRECT_URL`, or via `vercel env pull`.
2. **One-time claim link:** if the database has zero users, `/setup` becomes reachable and accepts a single admin creation, guarded by `SETUP_TOKEN` from the environment. The route self-disables permanently the moment a user exists.

---

## 22. Testing Strategy

| Layer | Tool | What it proves |
|---|---|---|
| Unit | Vitest | Due-date maths across DST-free IST, renewal rules, copy-code generation, permission resolution, donor-consent rendering |
| Integration | Vitest + real Postgres (Neon branch per CI run) | Services end-to-end against the schema, including transactions and constraint violations |
| E2E | Playwright | Five golden flows: register→approve→activate→login; issue→return; renew at limit; password reset; admin changes settings and the UI reflects it |
| Accessibility | axe-core in Playwright | Zero violations on `/`, `/join`, `/reader`, book detail, `/desk` |
| Security | Targeted integration tests | The list below |

**Security tests that must exist and must pass:**

- An unauthenticated request to every `/desk` and `/admin` route redirects, and the underlying *service* also refuses.
- Child A requesting Child B's loan/profile/history gets 404 — not 403 (no existence leak).
- A librarian calling settings, role or staff services is refused.
- No API response or server action result anywhere contains `password_hash`.
- An expired activation token fails; a consumed one fails; a second use of a valid one fails.
- A password-reset token expires on schedule and is single-use.
- Two concurrent issues of the same copy → exactly one loan, the other gets a friendly conflict.
- Duplicate `copy_code` and duplicate `member_code` are rejected by the database.
- A registration for the same child+apartment doesn't create a second account.
- Overdue is computed correctly at the day boundary in Asia/Kolkata.
- Renewal is refused at `max_renewals`.
- A suspended member cannot borrow and cannot log in.
- Uploading a `.php` renamed to `.jpg` is rejected by magic-byte sniffing.
- An anonymous donor's name never appears in any public response payload.

**Coverage targets:** `server/services` ≥ 90%, everything else ≥ 70%. CI blocks merge below target.

---

## 23. Documentation Plan

All in `docs/`, written as the code lands rather than at the end:

`README.md` · `ARCHITECTURE.md` · `ARCHITECTURE_DECISIONS.md` · `SETUP.md` · `DEPLOYMENT.md` · `DATABASE.md` · `SECURITY.md` · `API.md` · `ENVIRONMENT_VARIABLES.md` · `TESTING.md` · `OPERATIONS.md` (backup, restore, incident) · `FUTURE_ROADMAP.md`

Plus three human guides, written in plain language and printable for the physical library wall:
`ADMIN_GUIDE.md` · `LIBRARIAN_GUIDE.md` · `CHILD_USER_GUIDE.md` (illustrated, one page: how to log in, how to find a book, how to bring it back).

`ARCHITECTURE_DECISIONS.md` starts with the eight ADRs already made here: modular monolith · Neon over Supabase · Auth.js with DB sessions · member code as login identity · title/copy split · permissions as data · library_id from day one · no RLS (server-only DB access).

---

## 24. Version 1 Implementation Plan

Six phases, each ending at something demonstrable. Sequential, roughly 2–3 working sessions each.

| Phase | Delivers | Done when |
|---|---|---|
| **0 — Foundation** | Repo, Next.js + TS strict + Tailwind, Prisma schema + first migration, seed (permissions, roles, avatars, categories, Mana Jardin library), design tokens, core `ui/` components, CI, Vercel deploy of a branded landing page | `library.msrx.co.in` shows a branded holding page; migrations run in prod |
| **1 — Identity** | Auth.js, login, activation, password reset, throttling, RBAC engine, middleware gates, audit service, `create-admin` CLI, admin shell | You log in as Super Admin; every security test in §22 for auth passes |
| **2 — Members** | `/join`, registration queue, approve/reject, member creation, activation email, guardian records, member list, suspend/reactivate | A real parent can register a real child and that child can log in |
| **3 — Catalogue** | Book title/copy CRUD, cover upload, categories, copy-code generation, donation intake with consent, catalogue browse + search, book detail, "Thank You, Book Donors" | 50 donated books are catalogued and searchable |
| **4 — Circulation** | Issue, return, renew, due dates, overdue derivation, renewal requests, desk dashboard, reader dashboard, my books, reading history | A book goes out and comes back through the UI |
| **5 — Polish & Production** | Email templates + daily cron, reports, announcements, settings & branding admin, empty/error/loading states, a11y sweep, docs, production checklist | §26 checklist fully green |

**Scope discipline:** anything not in the brief's §48 list is written to `FUTURE_ROADMAP.md`, not built.

---

## 25. Decisions — Confirmed by Owner (2026-08-16)

All five settled. These are now binding on implementation and belong in `ARCHITECTURE_DECISIONS.md`.

**1. Child login identity — card code OR username, one field.**
The login field accepts either `MJCL-R042` or a simple username chosen by the parent at activation (`aarav15`). Resolution order: exact `member_code` match, then `username` match, then fail with the single generic error. Staff continue to log in by email. `username` is unique per library, lowercased, 3–20 characters, letters/digits/hyphen only, and validated against a reserved-word list at activation.

**2. Member password policy — 6 characters minimum, no complexity rules.**

> **Revised 2026-08-17 to 8 characters (ADR-013).** The Phase 1 brief asked for
> this to be re-examined rather than carried forward by default, and 6 proved
> too few. No complexity rules were added — the increase is length only. The
> paragraph below is kept as the original record of the decision.

Checked against a common-password blocklist, no character-class requirements, show/hide toggle on every entry field. Compensating controls: 5 failures → 15-minute lock with escalation, per-IP hourly cap, short sessions on shared devices. **Staff accounts are unaffected and remain strict: 12 characters minimum, zxcvbn score ≥ 3.**

**3. Catalogue visibility — members only by default, and configurable.**
`library_settings.catalogue_visibility` defaults to `MEMBER_ONLY`.

> **Revised 2026-08-17 (Phase 0 instruction).** This originally read "public by
> default", on the grounds that book data contains no child data. The owner
> directed that the shelf stays behind the front door for this deployment. Both
> values remain available and a Super Admin can switch without a deploy; only
> the default changed. See ADR-007.

**4. Circulation — librarian-only issue and return.**
A physical book changes hands at the desk, so the desk records it. Children cannot issue, return or renew directly. Children may raise a **renewal request** (`renewal_request` table), which appears on the desk dashboard for one-tap approval. Self-checkout is explicitly out of scope for v1 and noted in the roadmap.

**5. Database — Neon Postgres, files on Vercel Blob.**
Confirmed change from the original brief; reasoning in §2.1. Region `ap-southeast-1` (Singapore). Pooled URL at runtime, direct URL for migrations, branch-per-PR for CI integration tests.

---

## 26. Risks and Recommendations

| # | Risk | Severity | Mitigation |
|---|---|:--:|---|
| 1 | **Children's data under India's DPDP Act 2023** — processing a child's personal data requires verifiable parental consent, and behavioural tracking / targeted advertising directed at children is prohibited | **High** | Explicit guardian consent captured and versioned at registration; consent record permanently attached; zero analytics, tracking pixels or third-party scripts on child-facing pages; documented data-deletion path in `SECURITY.md`. **Recommend a lawyer or a knowledgeable resident reviews the consent wording before launch — I am not a legal advisor** |
| 2 | **Activation emails landing in spam** kills onboarding silently | **High** | Verified sending domain with SPF + DKIM before launch; `email_event` log so a librarian can see delivery; a "copy activation link" fallback in the desk UI for in-person setup |
| 3 | **Children forget passwords, constantly** | High | Guardian email is the reset channel; librarian can trigger a fresh activation link in one click (never sees the password); the reset email is written for the parent |
| 4 | **The Yoga Room is a shared device environment** | Medium | Prominent **[End session]**; short idle timeout on the desk app; a future kiosk mode auto-logging out after inactivity |
| 5 | **Free-tier database pausing / cold starts** | Medium | Neon over Supabase (§2.1); `/api/health` pinged by a free uptime monitor; verify current plan terms at setup |
| 6 | **Volunteer turnover** — the librarian who knows the system leaves | Medium | Printable one-page guides; the desk UI must be learnable in five minutes without training; Super Admin can create staff accounts unaided |
| 7 | **Books walk off** — no fines, no deposits, entirely trust-based | Medium | Accurate records and gentle reminders are the whole mitigation; accept some loss as the cost of an open community library. Do **not** let anyone talk the software into a punitive direction |
| 8 | **Scope creep into reading badges, challenges and gamification** | Medium | Roadmap file, not the codebase. Phase 1 must be *boringly reliable* before it is *fun* |
| 9 | **Child photos are the most sensitive data we hold** | Medium | Optional by design, private storage, signed access, EXIF stripped, deletable on request; twelve genuinely appealing avatars so nobody feels they must upload |
| 10 | **Vercel Hobby is for non-commercial use** | Low | A free community library qualifies; if the platform is ever used commercially by another community, that becomes a Pro plan conversation |
| 11 | **Child-friendly pastel palettes routinely fail contrast** | Low | Every colour token contrast-measured against its real surface during Phase 0, not judged by eye |
| 12 | **Multi-community demand arrives sooner than expected** | Low | `library_id` everywhere and a scoped repository layer mean this is a routing and admin problem later, not a migration |

### Changes I recommend to the brief before we start

1. **Neon instead of Supabase** for the database, Vercel Blob for files (§2.1) — operational reliability.
2. **Member login by card code / username, not email** (§11) — the brief's registration form collects only the *parent's* email, which is correct, but that means the child's identity cannot be an email address.
3. **Junior Librarian: seed the role and its permissions in v1, keep it unassignable.** The brief says architect for it; seeding it costs nothing now and proves the RBAC design actually works.
4. **Add an explicit guardian consent record** to registration (risk 1) — a checkbox plus a versioned, timestamped row. Small addition, meaningful legal posture.
5. **Reservations/holds stay out of v1** even though `RESERVED` appears in the book status list. The status value ships; the workflow doesn't. One shelf, one room, fifty books — holds add real complexity for little benefit at this size.
6. **Add `docs/OPERATIONS.md`** to the documentation set — backup, restore and "what to do when something breaks on a Saturday". The brief's doc list is thorough but has no runbook.

---

**§25 decisions are confirmed. Phase 0 is complete — see `docs/PHASE-0.md`.**

Three further decisions were made during implementation and are recorded as
ADRs: Next.js 16 rather than 15 (ADR-004), the catalogue default above
(ADR-007), and opaque server-side sessions after discovering that the Auth.js
Credentials provider cannot use native database sessions (ADR-009).
