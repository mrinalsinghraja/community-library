# Local setup

## Requirements

- **Node 24** (`.nvmrc` pins it; `nvm use` picks it up)
- **PostgreSQL 17** locally, or a Neon development project
- npm 11+

## 1. Install

```bash
nvm use
npm install
```

## 2. Databases

```bash
# macOS, via Homebrew
brew install postgresql@17
brew services start postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

createdb library_dev
createdb library_test     # the test suite truncates every table in this one
```

## 3. Environment

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
DATABASE_URL="postgresql://$USER@localhost:5432/library_dev?schema=public"
DIRECT_URL="postgresql://$USER@localhost:5432/library_dev?schema=public"
TEST_DATABASE_URL="postgresql://$USER@localhost:5432/library_test?schema=public"
AUTH_SECRET="$(openssl rand -base64 32)"
AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
EMAIL_PROVIDER="console"
CRON_SECRET="anything-for-local-use"
```

## 4. Migrate and seed

```bash
npx prisma migrate deploy
npx prisma generate

npm run db:seed:demo        # configuration + fake people and books
```

The demo seed prints its sign-ins:

| Role | Sign in with | Password |
|---|---|---|
| Super Admin | `admin@example.invalid` | `dev-super-admin-password` |
| Librarian | `librarian@example.invalid` | `dev-librarian-password` |
| Reader | `MJCL-R0001` or `demoreader` | `readabook` |

**These accounts exist only in development.** `db:seed:demo` refuses to run when
`NODE_ENV=production`, because it creates a fake child.

For a production-shaped local setup, use `npm run db:seed` (configuration only)
followed by `npm run create-admin`.

## 5. Run

```bash
npm run dev            # http://localhost:3000
```

Also prepare the test database once:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

## 6. Before pushing

```bash
npm run verify         # typecheck + lint + unit tests
npm run test:db        # database tests
```

## Troubleshooting

**`Invalid server environment configuration`** — `src/server/env.ts` validated
`.env` and something is missing. The message names the key. `AUTH_SECRET` must
be at least 32 characters.

**`No library row exists`** — run `npm run db:seed`.

**Database tests refuse to start** — `TEST_DATABASE_URL` is unset. This is
deliberate: those tests truncate every table, so they will not guess which
database you meant.

**A migration dropped an index** — see the warning in
[`DATABASE.md`](DATABASE.md) §5. `prisma migrate dev` removes raw indexes it
cannot find in `schema.prisma`. Check the generated migration for unintended
`DROP INDEX` statements.
