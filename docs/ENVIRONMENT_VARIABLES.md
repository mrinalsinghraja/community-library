# Environment variables

`src/server/env.ts` validates these at import time with Zod, so a misconfigured
deployment fails loudly at boot rather than mysteriously later. Error messages
name the offending key and never print its value.

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored;
`.env.example` is deliberately un-ignored so the template stays in the repo.

---

## Required everywhere

| Variable | What it is | How to get it |
|---|---|---|
| `DATABASE_URL` | **Pooled** Postgres connection, used at runtime | Neon dashboard → Connection string → *Pooled connection* |
| `AUTH_SECRET` | Key that encrypts the session cookie. Minimum 32 characters | `openssl rand -base64 32` |

**Rotating `AUTH_SECRET`** signs everyone out and invalidates pending activation
and reset links. It also breaks correlation of previously hashed IPs, since
those are HMACs keyed with it. Rotate deliberately.

## Required in production

| Variable | What it is | Notes |
|---|---|---|
| `DIRECT_URL` | **Unpooled** Postgres connection | Prisma migrations must not run through a pooler |
| `AUTH_URL` | Canonical origin, e.g. `https://library.msrx.co.in` | Auth.js builds callback URLs from it |
| `NEXT_PUBLIC_APP_URL` | Same origin, used in links | The only `NEXT_PUBLIC_*` variable — it is safe to expose |
| `CRON_SECRET` | Bearer token guarding `/api/cron/daily` | `openssl rand -base64 32`. Without it the route returns 503 rather than running unauthenticated |

## Optional

| Variable | Default | What it does |
|---|---|---|
| `AUTH_TRUST_HOST` | unset | Set `true` behind a proxy such as Vercel |
| `APP_TIMEZONE` | `Asia/Kolkata` | Bootstrap only. Once a library row exists, `library_settings.timezone` is authoritative |
| `TEST_DATABASE_URL` | unset | Needed for `npm run test:db`. **The test suite truncates every table in this database** — point it at a throwaway |
| `BLOB_READ_WRITE_TOKEN` | unset | Injected by Vercel when a Blob store is linked. **Required in production**: without it the process refuses to store an upload rather than writing a child's photograph to a container's own disk |
| `PASSWORD_BREACH_CHECK` | unset (off) | `true` checks new passwords against Have I Been Pwned using k-anonymity — only a 5-character hash prefix leaves the server, never the password. Fails open with a 2.5s timeout, so a family can always finish setting up an account. It is an outbound request from a child-facing form, which is why it is opt-in |

## Email

Used since Phase 1 for activation, verification and password recovery, and since
Phase 4 for circulation reminders. `EMAIL_PROVIDER=console` — the development
default — writes to `.mail/` and cannot reach a real address.

| Variable | Notes |
|---|---|
| `EMAIL_PROVIDER` | `resend` · `smtp` · `console`. **`console` is development only and is refused in production** — the transport there returns a failure with a reason instead of capturing to a directory nobody reads |
| `RESEND_API_KEY` | Required when provider is `resend` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `SMTP_SECURE` | Required when provider is `smtp` |
| `EMAIL_FROM` | Required whenever email is enabled |
| `EMAIL_REPLY_TO` | Optional |

Cross-field validation runs only in production: choosing `resend` without a key,
or enabling email without `EMAIL_FROM`, fails at boot.

In development, `EMAIL_PROVIDER=console` writes messages to `.mail/` and opens
no socket at all — nothing can reach a real family from a laptop. `/dev/mail`
renders that directory and 404s in production.

**The sending domain must have SPF and DKIM configured.** Without them,
activation links land in spam and no family can complete registration — which
breaks onboarding silently, the worst kind of failure.

## Never do these

- Never commit `.env`. CI runs gitleaks over full history.
- Never put a real secret in `.env.example`.
- Never add a secret to `NEXT_PUBLIC_*` — that prefix ships the value to the
  browser.
- Never log the value of any variable here; log the key name only.

## Where they live

| Environment | Where |
|---|---|
| Local | `.env` (gitignored) |
| Vercel Preview | Vercel → Settings → Environment Variables → Preview |
| Vercel Production | Vercel → Settings → Environment Variables → Production |
| CI | Fake values in `.github/workflows/ci.yml` against a throwaway service container. No real secret is needed for CI to pass |

Pull production values locally with `vercel env pull` when you need to run
`npm run create-admin` against production.
