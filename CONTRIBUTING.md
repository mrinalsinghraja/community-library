# Contributing

Thank you for looking. This is a free library system for a residential
community's children's library, built for readers aged roughly 5 to 14 and run
by volunteers. It is MIT licensed, so you are welcome to use it, adapt it, and
send improvements back.

## Ways to help

- **Ask a question or report a bug** — [open an issue](https://github.com/mrinalsinghraja/community-library/issues).
  Say what you did, what you expected and what happened.
- **Fix or improve the documentation** — typos, unclear steps, missing detail.
  These are the easiest first pull requests.
- **Fix a bug or add a feature** — please open an issue first for anything
  larger than a small fix, so we agree on the approach before you write it.

## Before you start

- **Never post real children's names, photographs, guardian details or any other
  personal data** in an issue, a pull request or a screenshot. Use the demo data
  (`npm run db:seed:demo`).
- **Never post a secret.** If you find a security problem, do not open a public
  issue: email mrinalsinghraja@gmail.com instead. What the system already
  protects is described in [`docs/SECURITY.md`](docs/SECURITY.md).
- Local work must never talk to a production database. See *Local work never
  talks to production* in the [README](README.md).

## Set up

You need Node 24 (`nvm use` reads `.nvmrc`) and PostgreSQL. Full steps are in
[`docs/SETUP.md`](docs/SETUP.md); in short:

```bash
git clone https://github.com/<your-username>/community-library.git
cd community-library
nvm use
npm install
cp .env.example .env     # fill in DATABASE_URL, DIRECT_URL and AUTH_SECRET
npm run db:deploy
npm run db:seed:demo     # demo data, development only
npm run dev
```

## Sending a pull request

1. Fork the repository and create a branch from `main`
   (for example `fix/overdue-wording`).
2. Make one focused change. Small pull requests are reviewed faster.
3. Run the checks and make sure they pass:

   ```bash
   npm run verify    # typecheck + lint + unit tests
   ```

   If you changed anything that touches the database, also run
   `npm run test:db` (it needs `TEST_DATABASE_URL`, and it truncates every table
   in whatever it points at — use a throwaway database).
4. Add or update tests for behaviour you change. Test real behaviour, not that a
   mock works — see [`docs/TESTING.md`](docs/TESTING.md).
5. Open the pull request and say what changed and why.

## Rules that are not negotiable

These come from the product, not from taste. A change that breaks one will not
be merged. The full list, with reasons, is in `CLAUDE.md`.

- **No community name in `src/`.** Names, logo, colours and loan rules live in
  configuration, so anyone can run their own library. A lint rule enforces it.
- **No hard-coded business rules.** Read limits and periods from the library
  settings.
- **Pages, components and actions never touch the database directly.** They call
  a service. Every service checks permission first and writes an audit row in
  the same transaction as any change. A lint rule enforces the first part.
- **Ownership comes from the session, never from the request.**
- **No payment code, no analytics, no tracking, no third-party scripts.**
  Children's behaviour is not measured.
- **No fines, no punitive language, no donor rankings or leaderboards.** Giving
  a book is never a condition of borrowing one.
- **Never invent cryptography.** Use what is already in use (argon2id, Auth.js).

For how the code is laid out, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
For why decisions were made, read
[`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md).

## Licence

By contributing you agree that your contribution is released under the
[MIT licence](LICENSE), the same as the rest of the project.
