# Production

How this library goes live, and what must never be done to it by hand.

`DEPLOYMENT.md` is the first-time setup narrative. This is the operating
document: the order things must happen in, the checks that decide whether the
system is fit to hold a real child's record, and the small list of things that
are the owner's to do because they need accounts and a browser.

> **Nothing in this file asks anyone to share a password.** Every credential is
> typed by its owner into the service that owns it, or generated on the
> owner's machine and pasted into Vercel's own environment screen.

---

## 1. The order matters

Each step depends on the one above it. Doing them out of order produces a site
that looks deployed and cannot onboard anybody.

| # | Step | Who | Blocks |
|---|---|---|---|
| 1 | Neon production project | Owner (browser) | everything |
| 2 | Vercel project linked to the GitHub repository | Owner (browser) | 3–8 |
| 3 | Vercel Blob store linked | Owner (browser) | photographs |

A store named **`library-media`** already exists (`store_x9oo4U7u7vYZkuzR`) but
is **in `iad1`, Washington DC, and is not linked to the project**. It was
created with the CLI's default region before the region flag was noticed, and
neither linking nor deleting a store can be done without a token that only
linking provides. Either link it in the dashboard, or delete it and create one
nearer the children whose photographs it holds:

```bash
vercel blob create-store library-media --region bom1
```

Where a child's photograph is physically stored is worth one deliberate
decision rather than a default.
| 4 | Email provider + verified sending domain | Owner (browser + DNS) | every activation link |
| 5 | Environment variables set in Vercel | Owner | the build |
| 6 | `prisma migrate deploy` + `npm run db:seed` | Anyone with the connection string | first sign-in |
| 7 | `npm run create-admin` | Owner | configuration |
| 8 | `library.msrx.co.in` DNS record | Owner (GoDaddy) | the real URL |
| 9 | Smoke tests | Anyone | the pilot |
| 10 | Pilot | The library | opening to the community |

Steps 1–4 and 8 need accounts and a browser. They are the owner's, and no
amount of tooling changes that.

## 2. Two things that now refuse rather than pretend

Both were found while reading the deployment path, and both used to fail
silently in exactly the way that is hardest to notice.

**Email.** `EMAIL_PROVIDER=console` writes messages to a `.mail/` directory and
returns success. On a laptop that is the point: nothing can reach a real
family. In production the directory belongs to a container that is about to
disappear, so every activation link, guardian verification and password reset
would be recorded as **SENT** and delivered nowhere. The transport now refuses
in production: the delivery log records **FAILED** with a reason that names the
configuration. A production deployment therefore needs a real provider before
it can onboard anybody — not before it can serve pages, but before a single
family can finish joining.

**Photographs.** Object storage used to fall back to the local filesystem
whenever `BLOB_READ_WRITE_TOKEN` was missing. On a serverless platform a
child's photograph would be written to a container's own disk: the upload
succeeds, the database row points at a key, and the bytes are gone by the next
request. There is no safe fallback for that, so there is no longer one — the
process refuses to start an upload without a Blob store.

## 2b. Both stores are in `iad1`

The Neon resource `neon-yellow-paddle` (Neon project `empty-truth-77069745`) and
the Blob store `library-media` both report `region: iad1` — Northern Virginia.
Neither was chosen; both are CLI/marketplace defaults.

That is where the children's names, dates of birth, apartment numbers,
photographs and guardian contact details would live. It is a decision worth
making on purpose rather than inheriting, and **a Neon project's region cannot
be changed after creation** — moving it means deleting the resource and adding
it again, which is free and instant while the database is empty and is neither
once it is not.

This is a question for the owner, not an answer this document should give.

## 2a. One thing that has never run for real

The Vercel Blob driver has **never been exercised against a real Blob store**.
Every test of the photograph pipeline runs against the local filesystem driver
or a fake, because that is all a laptop and a CI container have.

The specific doubt: private objects are read back with `head()` followed by a
plain `fetch` of the URL it returns. That is correct for a public object. For a
private one the SDK now offers `get(pathname, { access: "private" })`, and if
the URL from `head()` is not fetchable without credentials, `get` returns
`null` and **a child's photograph 404s in production while working perfectly in
development**.

So, before any real child's photograph is stored:

1. Upload a photograph through the desk on production.
2. Load it as the librarian — it must render.
3. Load the same `/api/media/<id>` signed out — it must be `404`.
4. Remove it, and confirm the bytes are gone.

If step 2 fails, the fix is a one-line change to the read path in
`src/server/lib/storage.ts`. It is listed here rather than guessed at, because
changing an untested path on a hunch is how a second bug gets added to a first.

## 3. Environment variables

Set in Vercel → Settings → Environment Variables, **Production** scope. Full
reference: [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** string | runtime |
| `DIRECT_URL` | *not set here* | migrations only — see §4; it belongs on the machine that runs them |
| `AUTH_SECRET` | `openssl rand -base64 32` | rotating it signs everyone out |
| `AUTH_URL` | `https://library.msrx.co.in` | |
| `AUTH_TRUST_HOST` | `true` | required behind Vercel |
| `NEXT_PUBLIC_APP_URL` | `https://library.msrx.co.in` | the only public variable |
| `CRON_SECRET` | `openssl rand -base64 32` | without it `/api/cron/daily` returns 503 |
| `BLOB_READ_WRITE_TOKEN` | injected by Vercel | link the Blob store; do not paste it by hand |
| `EMAIL_PROVIDER` | `resend` or `smtp` | **not** `console` |
| `EMAIL_FROM` | `Mana Jardin Children's Library <library@…>` | domain must have SPF and DKIM |
| `APP_TIMEZONE` | `Asia/Kolkata` | bootstrap only; the library's own setting wins afterwards |

Never set: `TEST_DATABASE_URL` (the suite truncates every table in it),
`PASSWORD_BREACH_CHECK` unless the community has decided it wants the outbound
request.

There is no bootstrap token. The first administrator is created by CLI.

## 4. Database

Production is a **separate Neon project**, not a branch of development and not
the local database. It is built from migrations, never from a dump of
development, because development contains a fake child.

**`vercel env pull` does not work for this.** The Neon integration writes its
variables as Vercel **sensitive** env vars (`makeEnvVarsSensitive: true`), and a
sensitive variable is write-only — it pulls back as an empty string, for the CLI
and for the dashboard alike. Verified: every Neon variable came back blank while
the ones set by hand came back intact.

So the connection strings come from the **Neon dashboard**, once, into a local
file that is deleted afterwards:

```bash
cat > .env.production.local <<'ENV'
DATABASE_URL="<Neon pooled connection string>"
DIRECT_URL="<Neon direct / unpooled connection string>"
ENV

npx dotenv -e .env.production.local -- npx prisma migrate deploy
npx dotenv -e .env.production.local -- npx prisma migrate status
npx dotenv -e .env.production.local -- npm run db:seed
rm .env.production.local
```

**`DIRECT_URL` belongs on the machine that runs migrations, not in Vercel.**
Prisma refuses to load the schema without it — `P1012: Environment variable not
found: DIRECT_URL` — but only for CLI commands that read the datasource.
`prisma generate` (which the build runs) and Prisma Client at runtime both work
without it; both verified. Adding it to Vercel would put a second copy of a
production credential somewhere nothing reads it.

`db:seed` creates permissions, roles, the community, the library, its settings,
categories and code sequences — **no people, no books**. `db:seed:demo` refuses
to run when `NODE_ENV=production`.

Confirm before going further:

```bash
npx prisma migrate status        # "Database schema is up to date!"
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

## 5. The first administrator

```bash
npm run create-admin
```

Prompts for name, email and password on the terminal. The password is never
echoed, never logged, never written to disk and never transmitted — only an
argon2id hash reaches the database. There is no default password anywhere in
this repository and no public route that can create an administrator.

Then configure the library **through the admin screens**, not through SQL:
`/admin/settings` for the rules, `/admin/branding` for the name, colour,
welcome message and logo. Keep it minimal; the defaults were chosen on purpose.

## 5a. Preview deployments are off

Set on the project, not in a document:

```
Ignored Build Step:  if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi
```

Vercel skips a build when that command exits 0, so only `main` at production
scope ever builds. Every pull request still gets the full CI run — typecheck,
lint, 656 tests, production build — against a throwaway Postgres, which is what
a preview would have been for.

This matters because the Neon integration scoped its variables to **Preview and
Production together**. Those variables are integration-managed and sensitive, so
narrowing them is a dashboard action (Storage → `neon-yellow-paddle` → the
project's Environments), not something the API exposes. With preview builds
disabled there is nothing for them to be injected into — but narrowing them is
still worth doing, because a disabled build step is one setting away from being
re-enabled by someone who does not know why it is there.

## 6. Domain

`msrx.co.in` is at GoDaddy. Add **one** record and touch nothing else — the
existing subdomains are live sites.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `library` | `76.76.21.21` | 600 |

That is the record Vercel asked for when the domain was attached to the
project. A `CNAME library → cname.vercel-dns.com` also works and is what the
other `msrx.co.in` subdomains use; either is fine, but not both.

The domain is already attached to the project, so the record is the only step
left. TLS is provisioned automatically once it resolves.

**Do not change the nameservers.** Vercel offers to take them over; that would
move `www`, `weather`, `planner` and every other live subdomain with it.

## 7. Health and the daily job

```bash
curl https://library.msrx.co.in/api/health          # {"status":"ok"}
curl -I https://library.msrx.co.in                  # headers, and HTTP → HTTPS
curl https://library.msrx.co.in/api/cron/daily      # 404 without the bearer secret
```

The health endpoint returns 503 when the database is unreachable and tells an
outsider nothing else. Point a free uptime monitor at it — it also keeps the
Neon compute warm enough that the first family of the day does not wait for a
cold start.

The daily job runs at 03:00 UTC (08:30 in Kolkata) and is safe to run twice.
If it misses a night nothing breaks: overdue status is derived at read time.

## 8. Backups

Neon's free tier restores six hours. That is not a backup for a library's
records.

```bash
pg_dump "$DIRECT_URL" --format=custom --file="library-$(date +%F).dump"
```

Keep the dumps somewhere neither Vercel nor Neon controls, and restore one into
a scratch database at least once. An untested backup is a hope.

## 9. Rollback

**Code:** Vercel → Deployments → promote the previous deployment. Nothing else
is needed; the application carries no build-time state.

**Database:** migrations are additive by policy. Nothing destructive ships
without a reviewed add → backfill → switch → remove sequence across releases,
so a code rollback never leaves the schema ahead of the application in a way
that loses data.

**What rollback does not undo:** an email that was sent, a code that was
allocated, or an audit row. Those are records of things that happened.

## 10. Incidents

| Situation | First move |
|---|---|
| Site down, health 503 | Neon project status. Scale-to-zero resumes on its own; a paused project does not |
| Nobody can sign in | Was `AUTH_SECRET` rotated? That ends every session and every pending link by design |
| Activation emails not arriving | Delivery log first. `FAILED` with a configuration reason means `EMAIL_PROVIDER`; `SENT` and missing means SPF/DKIM or a spam folder |
| A photograph will not upload | Blob store still linked? The process refuses rather than writing to a container |
| Someone must be locked out now | Suspend the account — every live session ends on their next request |
| Suspected data exposure | Suspend, then read `/admin/audit`. Do not delete anything: the audit log is the record of what happened |

Security problems go to the library's Super Admin directly, never into a public
issue tracker.

## 11. What must never be changed by hand

- **Loan rows.** A due date a child was told is a promise. Settings change the
  future only.
- **Consent records.** Immutable by design; the wording lives in code so that
  no record can end up describing text nobody saw (ADR-033).
- **Audit rows.** Append-only. There is no edit path and there must not be one.
- **Codes.** `MJCL-R…` and `MJCL-B…` are printed on cards and books. Changing a
  prefix changes the next one issued, never an existing one.
- **`copy.status` in SQL.** The one-active-loan rule is enforced by deferred
  constraint triggers; hand edits fight them. Use `npm run reconcile:circulation`.
- **The production database from a laptop.** Read if you must; write through
  the application.

## 12. Deployment checklist

- [ ] Neon **production** project created, separate from development
- [ ] `prisma migrate status` clean; drift check clean
- [ ] `npm run db:seed` run; **no demo data**
- [ ] Blob store linked; `BLOB_READ_WRITE_TOKEN` present
- [ ] `EMAIL_PROVIDER` is `resend` or `smtp`, with SPF and DKIM on the sending domain
- [ ] `AUTH_SECRET` and `CRON_SECRET` generated fresh for production
- [ ] `AUTH_URL` and `NEXT_PUBLIC_APP_URL` both `https://library.msrx.co.in`
- [ ] First Super Admin created with `npm run create-admin`
- [ ] `.env.production.local` deleted
- [ ] Domain resolves; HTTPS valid; HTTP redirects
- [ ] `/api/health` → `{"status":"ok"}`
- [ ] `/api/cron/daily` → 404 without the secret; cron job listed in Vercel
- [ ] Security headers present
- [ ] `/dev/mail` → 404
- [ ] Overdue reminders **off** (they are off by default and refused while unconfigured)
- [ ] One logical backup taken and one restore tested
- [ ] Smoke tests in [`PILOT_TESTING.md`](PILOT_TESTING.md) passed
