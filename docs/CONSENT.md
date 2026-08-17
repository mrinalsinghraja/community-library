# Consent

> # ⚠️ LEGAL REVIEW REQUIRED BEFORE PRODUCTION USE
>
> This document describes a **technical** implementation of versioned parental
> consent. Implementing it does not establish legal compliance, and nothing in
> this repository should be read as a claim that it does.
>
> Two things need review by someone qualified, before any real child's data is
> entered:
>
> 1. **The wording** in `src/lib/consent.ts`.
> 2. **The strength of verification.** Version 1 records a guardian ticking a
>    box on a web form. India's Digital Personal Data Protection Act, 2023
>    requires *verifiable* parental consent, and a tickbox may not meet that bar.
>
> The system is built so that a stronger method can be added without touching
> the registration workflow — see §4.

---

## 1. Why a ledger rather than a boolean

`consent = true` records nothing useful. It does not say what was agreed to,
when, by whom, under which wording, or how the person was verified — and if the
wording later changes, a boolean silently claims the family agreed to the new
text.

So consent is a table:

| Column | Why it exists |
|---|---|
| `type` | account creation, photo storage, email notifications — separable, withdrawable separately |
| `status` | GRANTED · WITHDRAWN · SUPERSEDED |
| `method` | how it was verified (§4) |
| `consent_version` | which version of the wording |
| `consent_text_snapshot` | **the verbatim text shown** |
| `granted_at` / `withdrawn_at` | when |
| `guardian_id` / `member_user_id` / `registration_request_id` | who it concerns |
| `recorded_by_id` | which staff member, for in-person consent |
| `ip_hash` / `user_agent_hash` | salted hashes, evidence that a specific submission happened |

The snapshot is the point. A later edit to the wording cannot rewrite what a
family actually agreed to.

Database constraints enforce the shape: a withdrawal must carry a timestamp, a
grant must carry non-empty wording and a version, and every record must attach
to a member or a registration. All three have tests.

## 2. The three consent types

| Type | Required? | Covers |
|---|---|---|
| `CHILD_ACCOUNT_CREATION` | **yes** | storing the child's name, date of birth, flat, and the guardian's contact details |
| `GUARDIAN_EMAIL_NOTIFICATIONS` | **yes** | activation and reset links, due-date reminders, library notices |
| `CHILD_PHOTO_STORAGE` | only if a photo is uploaded | storing the photograph privately |

Email consent is required because the guardian's inbox is the *only* recovery
channel a child has. Without it there is no way to give a family back an account
they have been locked out of.

Photo consent is modelled and ready; the upload field itself is not yet exposed
(`REGISTRATION.md` §6).

## 3. One source of wording

`src/lib/consent.ts` holds the text. The registration form renders it, the
consent record snapshots it, and the seed imports it. There is deliberately no
second copy — a second copy of consent wording is a second version of what a
family agreed to.

**Changing any wording requires bumping `CONSENT_VERSION`.** Existing records
keep the version and the snapshot they were granted under, so history stays
intact, but the version change is the signal that older consents were given
against different text.

The wording is community-agnostic — it says "the library", never a name — so the
platform stays reusable and the branding lint rule holds.

## 4. Verification methods, and room to grow

```
enum ConsentMethod {
  WEB_FORM               // v1: a guardian ticked the box
  EMAIL_CONFIRMATION     // + confirmed via an emailed link
  ADMIN_VERIFIED         // a librarian confirmed the guardian in person
  OTHER_VERIFIED_METHOD  // reserved
}
```

Adding a stronger method is a new enum value plus a new code path. It is not a
schema change, not a registration rewrite, and not a migration of existing
records — which is exactly the point of storing the method rather than assuming
one.

Two paths that would raise verification strength materially, if a review calls
for it:

- **Email confirmation** — the guardian must click a link before the librarian
  can approve. Cheap; already expressible.
- **Librarian verification in person** — a community library has a real
  advantage here: the librarian usually knows the family. Recording
  `ADMIN_VERIFIED` with `recorded_by_id` is arguably stronger evidence than
  anything a web form can produce.

**Identity documents are not collected and should not be added** without a
specific, approved reason.

## 5. Withdrawal

`status = WITHDRAWN` with a timestamp. The grant row is never deleted — that
would destroy the evidence that consent once existed, which matters as much as
the evidence that it was withdrawn.

The withdrawal *workflow* (a guardian asking, a librarian recording it, and what
follows for the account) is not built in Phase 1. The data model supports it and
`AUDIT_ACTIONS.CONSENT_WITHDRAWN` is defined.

## 6. What is deliberately absent

- No behavioural tracking, analytics, advertising identifiers or third-party
  scripts anywhere in the application. The DPDP Act bars tracking and targeted
  advertising directed at children, and the simplest way to comply is to have
  none of it.
- No consent "pre-ticked" — both boxes start empty and the form refuses to
  submit without them.
- No claim, anywhere in the UI, that ticking a box makes anything legal.
