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
> 2. **The strength of guardian verification** — now a separate concern with its
>    own document: **[`GUARDIAN_VERIFICATION.md`](GUARDIAN_VERIFICATION.md)**.
>
> **A ticked box is not verification, and this codebase no longer implies that it
> is.** See §0.

---

## 0. Consent is not verification

Phase 1 blurred these together. Phase 1.1 separates them permanently, in the
schema, in the services, and on the librarian's screen.

| | **Consent** — this document | **Guardian verification** — [that one](GUARDIAN_VERIFICATION.md) |
|---|---|---|
| Question | Did a guardian agree, to what wording, when — and can they withdraw it? | What evidence is there that the person who agreed is really the guardian? |
| Table | `consent_record` | `guardian_verification` |
| A tickbox gives you | A real, versioned, withdrawable record | Essentially nothing |

A guardian can give perfectly good consent while the library has no idea who they
are. That is the normal case for a web form. It is not a defect — it is a
different axis, and collapsing the two into one green tick on the screen where a
child's account is approved is precisely the mistake worth engineering against.

The registration queue therefore shows two separate, explicitly labelled states:

```
CONSENT               Complete
GUARDIAN VERIFICATION Missing   Self-declared only · needs Staff confirmed
```

Whether a given verification strength satisfies "verifiable parental consent"
under the applicable law is a legal question. It is answered by a **setting**,
`library_settings.required_guardian_verification`, never by a constant in code —
so this software never hard-codes a claim about what the law requires.

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

## 4. How the consent reached us

```
enum ConsentMethod {
  WEB_FORM               // a guardian ticked the box
  EMAIL_CONFIRMATION     // + confirmed via an emailed link
  ADMIN_VERIFIED         // a librarian recorded it in person
  OTHER_VERIFIED_METHOD  // reserved
}
```

This records the **channel the agreement arrived through**. Since Phase 1.1 it is
no longer doing double duty as a statement about identity — that moved to
`guardian_verification`, which has its own methods, its own ordered strengths, a
configurable production gate, and its own document.

Keep the two straight when reading a record:

- `consent_record.method = WEB_FORM` → *the agreement came in over the web form*
- `guardian_verification.method = SELF_DECLARED` → *and we did not check who sent it*

**Identity documents are not collected and must not be added** without a
specific, approved reason. Neither table has anywhere to put one, deliberately.

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
- No consent "pre-ticked" — every box starts empty and the form refuses to
  submit without the required ones.
- No claim, anywhere in the UI, that ticking a box makes anything legal.
- No legal advice inside the application. The librarian's screen states what the
  software recorded; it never tells anyone what the law requires of them.

## 7. Where the Indian rules actually stand — 17 August 2026

Stated in layers, because these are routinely blurred together:

| Layer | Status |
|---|---|
| **Enacted law** | Digital Personal Data Protection Act, 2023 — passed 11 August 2023 |
| **Notified rules** | DPDP Rules, 2025 — notified by MeitY, published 14 November 2025 |
| **In force today** | Rules 1–2 and the Data Protection Board provisions (Rules 16–21), since 13 November 2025 |
| **From 13 Nov 2026** | Rule 4 (Consent Managers) |
| **From 13 May 2027** | The substantive obligations, **including Rule 10 on children's data and verifiable parental consent** |

**So the verifiable-parental-consent obligation is enacted and notified, but not
yet in force** — it commences 13 May 2027, roughly nine months from today. That
is a reason to have the architecture ready. It is not a reason to claim
compliance, and it is not a reason to delay the legal review, because the wording
review is needed the moment a real child's data is entered — which can happen
long before 2027.

Verify these dates against the current MeitY materials before relying on them.
Enforcement timelines have moved before. Detail, sources and the technical
implications are in [`GUARDIAN_VERIFICATION.md`](GUARDIAN_VERIFICATION.md) §6.
