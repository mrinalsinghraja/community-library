# Community Children's Library Platform

A small, free library management system for a residential community's children's
library. Built for readers aged roughly 5–14, run by volunteers, and designed so
the children themselves can eventually operate it.

**First deployment:** Mana Jardin Children's Library
**Status:** Phase 0 — foundation complete. See [`docs/PHASE-0.md`](docs/PHASE-0.md).

---

## What this is

- **Free.** No membership fee, no borrowing fee, no fines. There is no payment
  code anywhere in this repository and there never will be.
- **Voluntary.** Donating books is never a condition of joining or borrowing.
- **Private.** Children's data is minimised, guardian contact details sit behind
  a permission, and no child can see another child's anything. There is no
  analytics, no tracking, and no third-party script on any page.
- **Reusable.** Nothing about any one community is compiled in. Names, logo,
  colours, age range, loan period and ID prefixes all live in one configuration
  row. A lint rule enforces it.

## Quick start

```bash
git clone <repository-url> && cd community-library
nvm use                 # Node 24 (see .nvmrc)
npm install
cp .env.example .env    # then fill in DATABASE_URL, DIRECT_URL and AUTH_SECRET
npm run db:deploy       # apply migrations
npm run db:seed:demo    # configuration + demo data (DEVELOPMENT ONLY)
npm run dev
```

Open <http://localhost:3000>. Demo sign-ins are printed by the seed.

For a real deployment, seed **without** `:demo` and create the first
administrator interactively:

```bash
npm run db:seed
npm run create-admin
```

Full instructions: [`docs/SETUP.md`](docs/SETUP.md) and
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (generates Prisma client first) |
| `npm run verify` | Typecheck + lint + unit tests — run before pushing |
| `npm test` | Unit tests (no database needed) |
| `npm run test:db` | Database tests (needs `TEST_DATABASE_URL`) |
| `npm run test:all` | Both suites |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply existing migrations (production) |
| `npm run db:seed` | Permissions, roles, library configuration — safe anywhere |
| `npm run db:seed:demo` | The above plus fake people and books — **development only** |
| `npm run create-admin` | Create a Super Admin, password typed and never echoed |

## Architecture in one paragraph

A modular monolith on Next.js (App Router) with PostgreSQL via Prisma.
Components and pages may not touch the database; they call services in
`src/server/services`, which are the only place business rules live and which
always call `requirePermission()` first and write an audit row in the same
transaction as any change. Authorization is data — roles map to permission keys
in the database — so a new role is a seed row, not a refactor. Sessions are
server-side records: the cookie holds an opaque handle, so suspending an account
ends its live sessions on the very next request.

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentation

| Document | Contents |
|---|---|
| [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) | The original approved design |
| [`docs/PHASE-0.md`](docs/PHASE-0.md) | What this phase delivered, and what it did not |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, boundaries, request flow |
| [`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md) | ADRs, with the reasoning and the alternatives |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Schema, constraints, migration workflow |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Controls, threat notes, children's data and consent |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | GitHub, Neon, Vercel, custom domain |
| [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) | Every variable, what it does, how to generate it |
| [`docs/TESTING.md`](docs/TESTING.md) | What is tested and why those things |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Tokens, measured contrast, component rules |

## Licence and ownership

Owned by the community it serves. Not a commercial product.
