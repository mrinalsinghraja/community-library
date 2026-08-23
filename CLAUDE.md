# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A free library management system for a residential community's children's
library. Readers are aged roughly 5–14. Volunteers run it, and the children
themselves are meant to run it eventually.

Read `docs/BLUEPRINT.md` (approved design) and `docs/PHASE-0.md` (what exists)
before changing anything structural.

## Commands

```bash
nvm use                 # Node 24 — pinned in .nvmrc
npm run dev
npm run verify          # typecheck + lint + unit tests — run before every push
npm run test:db         # database tests; needs TEST_DATABASE_URL
npm run db:seed:demo    # development data (refuses to run in production)
npm run create-admin    # secure Super Admin creation
```

## Rules that are not negotiable

These come from the product, not from taste. Breaking one is a defect.

1. **No community name in `src/`.** Every literal lives in
   `prisma/seed/library-config.ts` and is read at runtime from
   `library_settings`. A lint rule enforces this.
2. **No hard-coded business rules.** No `14`, no `5`, no `2` in logic — read
   them from `getLibrarySettings()`.
3. **Components, pages and actions never touch Prisma.** Call a service. A lint
   rule enforces this.
4. **Every service entry point calls `requirePermission()` first**, and writes
   an audit row in the same transaction as any change.
5. **Ownership comes from the session, never the request.** A child asking for
   another child's id gets `NotFound`, not `NotAuthorized` — 403 would confirm
   the id is real.
6. **Overdue is derived** (`due_at < now()`), never stored.
7. **No payment code. No analytics. No tracking. No third-party scripts.**
   The DPDP Act bars behavioural tracking of children, and there is no fee of
   any kind in this library.
8. **No donor rankings, leaderboards or counts.** Gratitude, not competition.
9. **Donation is never a condition of membership** — not in schema, not in copy.
10. **No fines, no punitive language.** "Ready to come home 🏠", never
    "OVERDUE".
11. **`--color-accent` never carries text.** It is 3.48:1. Use `accent-ink`.
12. **Never invent cryptography.** argon2id, `crypto.randomBytes`, Auth.js.

## Architecture in one line

Modular monolith: `app` → `actions` → `services` → `repositories` → Prisma, with
permissions as database rows and sessions as server-side records.

## Traps discovered the hard way

- **`prisma migrate dev` drops raw indexes** it cannot find in `schema.prisma`.
  Define raw indexes as *expression* indexes. CI fails on drift.
- **Compound unique keys in Prisma client** use field names
  (`libraryId_email`), not the `map:` constraint name.
- **`@node-rs/argon2`'s `Algorithm` is an ambient `const enum`** — unusable
  under `isolatedModules`. The value is written as a literal.
- **`server-only` throws under Vitest**; it is aliased to a stub in
  `vitest.config.mts`.
- **Pages reading configuration must be `force-dynamic`**, or Next prerenders
  them and freezes the library's settings at build time.
- **Middleware is `proxy.ts`** in Next 16, and it is a tidiness gate only — it
  has no database access and cannot authorize anything.

## Before saying something works

Run it. This repository's documentation distinguishes what was verified from
what was assumed, and that distinction is worth keeping.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
