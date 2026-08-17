# Guardian Verification

> ## ⚠️ LEGAL REVIEW REQUIRED BEFORE PRODUCTION USE
>
> This document describes what the **software records**. It does not, and cannot,
> establish that any of it satisfies a legal requirement. Which verification
> strength a deployment must require is a legal decision, and it belongs to the
> library — which is why it is a database setting and not a constant in code.
>
> **Nothing in this repository is legal advice.**

---

## 1. The distinction this whole document exists to hold open

Phase 1 conflated two different claims. Phase 1.1 separates them, permanently.

| | **Consent** | **Guardian verification** |
|---|---|---|
| Question | Did a guardian agree, to what wording, when — and can they withdraw it? | What evidence is there that the person who agreed is really the child's guardian? |
| Record | `consent_record` | `guardian_verification` |
| Source of truth | `src/lib/consent.ts` | `src/lib/guardian-verification.ts` |
| A ticked box gives you | A real, versioned, withdrawable consent record | Essentially nothing |

A guardian can give perfectly good consent while the library has no idea who they
are. That is the normal case for a web form, and it is not a bug — it is simply a
different axis, and the two must not be collapsed into one green tick on the
screen where a child's account is approved.

**Why they are separate tables rather than columns on one:** raising the
verification bar later must not require rewriting consent history. A family who
consented in August under wording v1 still consented under wording v1, whatever
the library later decides about identity checks. Merging them would make one
impossible to change without falsifying the other.

## 2. Methods

Technical categories. **None of these names is a claim of legal sufficiency.**

| Method | What actually happened | Strength |
|---|---|---|
| `SELF_DECLARED` | Somebody ticked a box on `/join` | `SELF_DECLARED` |
| `EMAIL_CONFIRMATION` | Somebody opened a single-use link sent to the guardian's inbox | `EMAIL_CONFIRMED` |
| `STAFF_VERIFIED` | A **named** member of staff confirmed the guardian | `STAFF_VERIFIED` |
| `VERIFIED_IDENTITY_PROVIDER` | An external verified-identity service asserted it | `IDENTITY_PROVIDER` |
| `OTHER` | A method a future legal review introduces | Decided by that review |

Adding a method is a new enum value, a strength mapping, and a code path. It is
not a change to the registration workflow and not a reshaping of the schema —
which was the point of building it this way.

### What is deliberately NOT collected

- No identity documents, of any kind
- No Aadhaar number or any other government identifier
- No scans, uploads or document references
- No KYC of any description

`evidence_note` is a sentence a librarian writes — *"spoke to her at the desk on
Saturday"* — and a CHECK constraint caps it at 500 characters specifically to
obstruct the habit of pasting identity details into a free-text field. The
librarian's own screen says so, in as many words.

## 3. Strength, and the one comparison that matters

Strengths are ordered weakest to strongest:

```
NONE  <  SELF_DECLARED  <  EMAIL_CONFIRMED  <  STAFF_VERIFIED  <  IDENTITY_PROVIDER
```

This is an ordering, not a score. It supports exactly one question: *is what we
have at least what this library requires?*

**Absence of evidence is the weakest state, not an exemption.** An account with
no verification record at all resolves to `NONE` and fails every requirement
above `NONE`. There is an explicit test for this, because the tempting bug is to
treat "no records found" as "nothing to check".

### The database refuses to let a tickbox lie

```sql
ALTER TABLE guardian_verification
  ADD CONSTRAINT guardian_verification_strength_matches_method
  CHECK (
    (method = 'SELF_DECLARED' AND strength = 'SELF_DECLARED')
    OR (method = 'EMAIL_CONFIRMATION' AND strength = 'EMAIL_CONFIRMED')
    ...
  );
```

One wrong literal in a service could otherwise record "somebody ticked a box" as
`IDENTITY_PROVIDER` and sail straight through the production gate. The database
refuses the row. Strength is also **frozen** at creation: re-scoring an old
record because policy changed would rewrite history.

Other constraints in the same file: a verification must attach to a subject; a
`VERIFIED` record must carry a timestamp; and a `STAFF_VERIFIED` record must name
the staff member — *"a member of staff confirmed it"* is worth nothing without
which member of staff.

## 4. The production safety gate

One setting decides everything:

```
library_settings.required_guardian_verification   (default: SELF_DECLARED)
```

It is checked in **two** places, not one:

1. **Approval** (`approveRegistration`) — no account is created until the
   requirement is met. The request stays `PENDING`/`UNDER_REVIEW`, so a librarian
   can return to it. It is not rejected; nothing is half-created.
2. **Activation** (`activateAccount`) — checked again before the account may
   become `ACTIVE`.

Two checks because the requirement can be raised while a request sits in the
queue, or while an activation email sits unread in an inbox. **When the bar goes
up, the accounts it went up for must not walk under it.** Tested explicitly.

Staff accounts are exempt from the activation gate: it is about the guardian of a
child, and a staff member has no guardian.

### What each setting means in practice

| Setting | What `/join` does on its own | What a librarian must do |
|---|---|---|
| `NONE`, `SELF_DECLARED` | Records the tickbox | Nothing — approve as normal |
| `EMAIL_CONFIRMED` | Emails the guardian a single-use link | Wait for the parent to open it |
| `STAFF_VERIFIED` | Records the tickbox only | Confirm the guardian and record how |
| `IDENTITY_PROVIDER` | Records the tickbox only | Not implemented — see §7 |

## 5. Development mode

While the requirement is `NONE` or `SELF_DECLARED`, the registration queue
carries this banner, and it is asserted by a test so a later edit cannot soften
it:

> **DEVELOPMENT / NOT PRODUCTION VERIFICATION** — this library currently accepts
> a ticked box as guardian verification. That records a claim; it does not check
> who the person is.

It is driven by the **setting**, never by `NODE_ENV`. A deployment can be in
production and still, wrongly, be configured this way — which is exactly when the
warning most needs to appear.

## 6. India's DPDP framework — status, as at 17 August 2026

Distinguishing the things that are routinely blurred together:

| | |
|---|---|
| **Enacted law** | Digital Personal Data Protection Act, 2023 — passed 11 August 2023 |
| **Notified rules** | Digital Personal Data Protection Rules, 2025 — notified by MeitY, published 14 November 2025 |
| **In force now** | Rules 1–2 and the Data Protection Board provisions (Rules 16–21), from 13 November 2025 |
| **From 13 November 2026** | Rule 4 (Consent Managers) |
| **From 13 May 2027** | The substantive obligations — notice, security, breach reporting, retention, **children's data (Rule 10)**, SDF duties, data-principal rights, cross-border transfer |

So: **the verifiable-parental-consent obligation is enacted and notified, but not
yet in force.** It commences 13 May 2027, roughly nine months from today. That is
a reason to have the architecture ready, not a reason to claim compliance.

Rule 10 concerns obtaining verifiable consent from a parent or guardian, and the
Rules contemplate mechanisms including Digital Locker–based verification. **This
codebase implements none of those.** What it does is make adding one a
configuration change plus a code path, rather than a rewrite.

**Layers that must not be confused:**

- *enacted law* — what Parliament passed
- *notified rules* — what MeitY published
- *commencement* — when a given rule actually binds anyone
- *technical implementation* — what this repository does
- *legal interpretation* — whether the implementation satisfies the rule

This document covers the fourth. **A lawyer must supply the fifth.**

Sources consulted (August 2026): the PIB notification of the DPDP Rules, 2025,
and published analyses of the staggered commencement schedule. Verify against the
current MeitY materials before relying on any date here — enforcement timelines
have moved before.

## 7. Honest limitations

1. **The consent wording has still not been legally reviewed** (`CONSENT.md`).
   Phase 1.1 changed nothing about that; it only stopped the software implying
   that a tickbox was an identity check.
2. **`VERIFIED_IDENTITY_PROVIDER` is representable but not implemented.** Setting
   the requirement to `IDENTITY_PROVIDER` would make approval impossible, because
   nothing can produce that strength. That is a deliberate fail-closed, but it is
   not a working option.
3. **`EMAIL_CONFIRMATION` proves control of an inbox, not parenthood.** Someone
   who can read that inbox can complete it. It is meaningfully stronger than a
   tickbox and meaningfully weaker than meeting somebody.
4. **`STAFF_VERIFIED` is exactly as good as the librarian recording it.** The
   software records who claimed it and when; it cannot check whether they
   actually did.
5. **Opening the emailed link is enough to confirm it.** An email client that
   prefetches links could spend the token. Weighed against asking a parent on a
   phone to press a second button they will not understand, the simpler flow was
   chosen; the consequence is a verification recorded slightly early for an
   address we chose to write to, not an account taken over.
6. **No expiry or reverification is scheduled.** The model carries `expires_at`
   and the read path honours it, but nothing sets it yet. A policy decision has to
   come first.

## 8. Decisions the library owner still owns

1. **What strength does production require?** Until this is answered by someone
   qualified, `SELF_DECLARED` is a development default and the banner stays up.
2. **Is `STAFF_VERIFIED` enough for this community?** For a library in the corner
   of a room where the librarian knows the families, it is plausibly the
   strongest verification available and cheaper than any technical alternative.
   That is a judgement, not a fact.
3. **Should verification expire?** If yes, after how long, and what happens to a
   child's account when it lapses.
