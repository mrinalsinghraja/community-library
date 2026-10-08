## What changed

<!-- One or two sentences: what this does, and why. Link the issue if there is one: Fixes #123 -->

## How it was checked

- [ ] `npm run verify` passes (typecheck, lint, unit tests)
- [ ] `npm run test:db` passes, if this touches the database (use a throwaway database)
- [ ] I tried the change in the browser, or it is documentation only

## Rules

- [ ] No real children's names, photographs, guardian details or secrets in the code, tests, screenshots or this description
- [ ] No community name, loan rule or other business rule hard-coded in `src/`
- [ ] No payment code, analytics, tracking or third-party scripts
- [ ] Pages and actions call a service; they never touch the database directly

<!-- The full list of rules is in CONTRIBUTING.md. Tick what applies; explain anything that does not. -->
