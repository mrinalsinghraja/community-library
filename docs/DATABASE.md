# Database

PostgreSQL via Prisma. 27 application tables plus Prisma's migration table.
All timestamps are `timestamptz` stored in UTC; every business date decision is
made in the library's configured timezone.

---

## 1. Shape

```
community ─1:N─ library ─1:1─ library_settings
                   │
                   ├─ app_user ─1:1─ member_profile
                   │     ├─ user_role ─ role ─ role_permission ─ permission
                   │     ├─ session          (server-side session records)
                   │     └─ auth_token       (activation / password reset)
                   │
                   ├─ guardian ─ guardian_member ─ app_user
                   ├─ registration_request ─ consent_record
                   │
                   ├─ book_category ─ book_title ─ book_copy ─1:1─ donation
                   │                                   └─ loan ─ loan_event
                   │                                        └─ renewal_request
                   │
                   ├─ code_sequence          (concurrency-safe code allocator)
                   ├─ media_object           (uploads, private by default)
                   └─ audit_log · announcement · email_event · login_attempt
```

## 2. Three separations that exist so the future is cheap

**`book_title` vs `book_copy`.** Three copies of *The Gruffalo* are one
catalogue entry and three shelf items, each with its own permanent code,
condition, donor and loan history. Retrofitting this later would mean rewriting
every circulation query.

**`app_user` vs `member_profile` vs `guardian`.** A guardian is not a borrower,
and a login identity is not library-card data. This keeps parent contact details
behind `member.view_contact`, which most staff screens never request.

**`loan` vs `loan_event`.** The loan is current state; events are the immutable
story. Renewals and due-date adjustments append rather than overwrite.

## 3. What the database enforces on its own

These live in `prisma/sql/001_constraints_and_indexes.sql`. They hold even if
application code is wrong, raced, or bypassed entirely — and each one has a test
in `tests/database/constraints.test.ts`.

| Guarantee | Mechanism |
|---|---|
| A copy can be on loan to one reader at a time | `CREATE UNIQUE INDEX one_active_loan_per_copy ON loan (copy_id) WHERE status = 'ACTIVE'` |
| The same child cannot queue twice | partial unique on `(library_id, lower(btrim(child_name)), lower(btrim(apartment)))` where status is open |
| Login identifiers are stored normalised | CHECKs: `email = lower(btrim(email))`, username shape `^[a-z0-9][a-z0-9-]{2,19}$` |
| Loans are coherent in time | `due_at > issued_at`; returned loans record when; active loans do not |
| Configuration cannot be saved broken | age range, loan period, limits, code padding, non-empty prefixes, `#rrggbb` colours |
| Consent is evidence | withdrawal requires a timestamp; wording snapshot required; must attach to a subject |
| Donor credit is renderable | `NAMED` needs a name; `APARTMENT_ONLY` needs an apartment |
| Sessions cannot be born dead | `expires_at > created_at`, `idle_expires_at <= expires_at` |
| Private media is never public | `PRIVATE` may not carry a `public_url` |

**Overdue is not a column.** It is derived as `due_at < now()` at read time, so
no failed scheduled job can leave the library believing something untrue.

## 4. Codes

`code_sequence` holds one row per (library, kind). Allocation is a single atomic
statement:

```sql
UPDATE code_sequence SET next_value = next_value + 1
 WHERE library_id = $1 AND kind = $2
RETURNING next_value - 1;
```

Postgres holds a row lock for the statement's duration, so concurrent callers
serialise and each gets a distinct value. Call it inside the same transaction as
the insert that uses it, so a failed insert rolls the reservation back instead of
burning a code. Codes are never reused, even after archiving — a code is a label
stuck to a real book.

Format rule: a prefix of letters and digits gets a `-` before the number
(`MJCL` → `MJCL-0051`); a prefix that already contains punctuation is treated as
complete (`MJCL-R` → `MJCL-R0042`).

## 5. Migration workflow

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate the migration WITHOUT applying it
npx prisma migrate dev --name describe_the_change --create-only

# 3. If the change needs SQL Prisma cannot express, append it to the generated
#    migration.sql and keep a copy under prisma/sql/ for the record.

# 4. Apply
npx prisma migrate dev

# 5. Confirm no drift — empty output means schema and migrations agree
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script
```

In production, only ever `npx prisma migrate deploy`. **Never `prisma db push`**
— it applies changes with no migration history and no review.

### ⚠ The gotcha that will bite you

`prisma migrate dev` **drops raw indexes it can introspect but cannot find in
`schema.prisma`**. During Phase 0 it silently removed a trigram index on the
next migration.

Defences now in place:
- Raw indexes are defined as **expression** indexes (e.g. `lower(title)`), which
  Prisma's reconciliation does not touch.
- CI fails on any drift between `schema.prisma` and the applied migrations.

After any `migrate dev`, check that the generated migration contains no
`DROP INDEX` you did not intend.

## 6. Deletion and retention

Accounts move `INVITED → ACTIVE → SUSPENDED → DEACTIVATED → ARCHIVED`. They are
not hard-deleted, and historical loan rows are not cascade-deleted with a
member: `loan.member_user_id` uses `onDelete: Restrict` precisely so that
closing an account cannot silently erase the library's own records.

The intended future strategy is to redact personal fields on `app_user` and
`member_profile` at `ARCHIVED` while leaving loan history intact and attributed
to a stable id. `audit_log.actor_label` is denormalised for exactly this reason —
the log stays readable after an account is archived.

**Retention periods are TBD** and require community and legal input. No period
has been invented here. See `docs/SECURITY.md`.

## 7. Local databases

```bash
createdb library_dev
createdb library_test          # the test suite truncates every table in this one
npx prisma migrate deploy
npm run db:seed:demo
```
