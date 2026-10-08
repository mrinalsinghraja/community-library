# Security policy

This software holds details about children and their families, so security
reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Email **mrinalsinghraja@gmail.com** with:

- what you found and where (a page, a request, a file in this repository),
- the steps to reproduce it, and
- what an attacker could do with it.

You will get a reply within 7 days. Once the problem is confirmed, it is fixed
before it is described publicly, and you are credited in the fix if you want to
be.

## What is covered

- The code in this repository, on the `main` branch.
- The live deployment at [library.msrx.co.in](https://library.msrx.co.in).

This is a volunteer project run by an individual, with no bug bounty.

## Testing the live site

If you test the live site, please:

- **Do not access, change or download anyone's personal data.** A readable
  record of a child or guardian is proof enough: stop and report it.
- Do not run automated scans that slow the site down, or try to lock out
  accounts.
- Do not use social engineering against volunteers or families.

You can test everything else on your own copy with demo data
(`npm run db:seed:demo`); see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What the system already does

[`docs/SECURITY.md`](docs/SECURITY.md) lists the controls in place, the threat
notes, and the problems already known, so you can check whether something is
new before you report it.
