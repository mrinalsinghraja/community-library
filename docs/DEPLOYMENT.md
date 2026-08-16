# Deployment

Target: `https://library.msrx.co.in` on Vercel, with Neon PostgreSQL.

Everything below needs accounts the project owner controls. Nothing here asks
for a password to be typed into a file or shared with anyone.

---

## 1. GitHub

```bash
cd community-library
git init                      # already done if you cloned
git add -A
git commit -m "Phase 0: foundation"
gh repo create community-library --private --source=. --push
```

Keep it **private**: the repository names a real residential community.

## 2. Neon — two projects, not one

Create **separate** projects for development and production. They must not share
a database.

1. <https://console.neon.tech> → New Project
2. Region: **Singapore (`ap-southeast-1`)** — nearest to Bengaluru
3. Postgres 17
4. From *Connection Details*, copy **both** strings:
   - **Pooled** → `DATABASE_URL`
   - **Direct / unpooled** → `DIRECT_URL`

Prisma migrations must use the direct connection; a pooler breaks them.

> Free-tier facts verified 2026-08-17: 0.5 GB storage per project, 100 CU-hours
> per project per month, scale-to-zero after 5 minutes of inactivity (resumes
> automatically), **point-in-time restore limited to 6 hours**. That last one is
> why a scheduled logical backup is required — see §8.

## 3. Vercel project

```bash
vercel whoami        # MUST be the account that owns this project
```

Then import the GitHub repository at <https://vercel.com/new>. Framework
detection handles the rest; `npm run build` already runs `prisma generate`.

## 4. Environment variables

Set these in Vercel → Settings → Environment Variables, for **Production** and
**Preview** separately (Preview should point at a Neon branch, never at
production data):

```
DATABASE_URL          pooled Neon string
DIRECT_URL            direct Neon string
AUTH_SECRET           openssl rand -base64 32
AUTH_URL              https://library.msrx.co.in
AUTH_TRUST_HOST       true
NEXT_PUBLIC_APP_URL   https://library.msrx.co.in
CRON_SECRET           openssl rand -base64 32
EMAIL_PROVIDER        console        (until email is configured in a later phase)
```

Full reference: [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

## 5. Migrate and seed production

Migrations are **not** run automatically by the build — applying schema changes
during a build is how a half-deployed migration happens. Run them deliberately:

```bash
vercel env pull .env.production.local     # never commit this file
npx dotenv -e .env.production.local -- npx prisma migrate deploy
npx dotenv -e .env.production.local -- npm run db:seed
```

`db:seed` (without `:demo`) creates permissions, roles, the community, the
library, its settings, categories and code sequences. It creates **no people**.

`db:seed:demo` refuses to run when `NODE_ENV=production`, because it contains a
fake child.

## 6. Create the first Super Admin

```bash
npx dotenv -e .env.production.local -- npm run create-admin
```

Prompts for name, email and password. The password is never echoed, never
logged, never written to disk, and never sent anywhere — only an argon2id hash
reaches the database. There is no default administrator password anywhere in
this repository.

Delete `.env.production.local` afterwards.

## 7. Custom domain

1. Vercel → Settings → Domains → add `library.msrx.co.in`
2. At the DNS provider for `msrx.co.in`, add exactly what Vercel shows —
   normally:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `library` | `cname.vercel-dns.com` | 600 |

   If the provider forces an A record at that name, use the IP Vercel gives you.

3. **Touch nothing else.** Existing records for `www`, `weather`, `planner` and
   the rest of the subdomains must be left alone.
4. Wait for propagation; Vercel provisions TLS automatically.
5. Verify: `https://library.msrx.co.in/api/health` returns `{"status":"ok"}`,
   and plain HTTP redirects to HTTPS.

## 8. Backups — required, not optional

Neon's free tier gives a 6-hour restore window. That is not a backup strategy
for a library's records.

Take a periodic logical dump you control:

```bash
pg_dump "$DIRECT_URL" --format=custom --file="library-$(date +%F).dump"
```

Store it somewhere the Vercel and Neon accounts do not control. Test a restore
into a scratch database at least once — an untested backup is a hope, not a
backup.

## 9. Production checklist

- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] HTTPS works; HTTP redirects
- [ ] Security headers present (`curl -I https://library.msrx.co.in`)
- [ ] Home page shows the correct library name and branding
- [ ] `/rules` shows the configured age range and loan period
- [ ] Super Admin can sign in
- [ ] `/account` shows the expected roles and permissions
- [ ] Signing out actually ends the session (cookie no longer works)
- [ ] `/api/cron/daily` returns 404 without the bearer secret
- [ ] Cron job appears in Vercel → Settings → Cron Jobs
- [ ] No `.env` file is committed (`git log -p | grep -i secret` finds nothing)
- [ ] A logical backup has been taken and a restore tested

## 10. Rollback

- **Code:** Vercel → Deployments → promote the previous deployment.
- **Database:** migrations are additive by policy. No destructive migration
  ships without an explicit, reviewed two-step plan (add → backfill → switch →
  remove in a later release).

## 11. Notes

- Vercel's Hobby plan is for non-commercial use. A free community library
  qualifies. If another community ever uses this commercially, that becomes a
  Pro-plan conversation.
- Hobby also limits cron frequency. This application needs exactly one daily
  run, which fits — verify the current limit when you set it up.
