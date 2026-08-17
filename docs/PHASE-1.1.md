# Phase 1.1 — Final identity corrections

Two corrections to Phase 1, plus the consequences of taking them seriously.

**Read this after `PHASE-1.md`.** Phase 2 (the book catalogue) has not been
started.

---

## 1. What changed, in one paragraph each

**The child photograph was built but not reachable.** Phase 1 validated and
tested uploads and then never put them on the form. `/join` now offers a
photograph, an avatar, or neither — in that order of prominence, reversed: the
avatars are visible and already chosen when the page loads, and adding a photo is
an extra step a parent takes only if they want to. Nothing is mandatory.

**A ticked box was standing in for knowing who somebody is.** Phase 1 recorded
consent honestly and then let the *method* of consent carry an implication about
identity it could not support. Verification is now its own model, its own ordered
strengths, its own gate, and its own document — and while the configured
requirement is weak, the librarian's screen says so in as many words.

## 2. The distinction, because it is the whole point

| | Consent | Guardian verification |
|---|---|---|
| Question | Did a guardian agree, to what wording, when — can they withdraw it? | What evidence is there that they are the guardian? |
| Table | `consent_record` | `guardian_verification` |
| A tickbox gives | A real, versioned, withdrawable record | Essentially nothing |

A guardian can give perfectly good consent while the library has no idea who they
are. That is the normal case for a web form. The registration queue therefore
shows two labelled states, never one tick:

```
CONSENT               Complete
GUARDIAN VERIFICATION Missing   Self-declared only · needs Staff confirmed
```

Detail: [`CONSENT.md`](CONSENT.md), [`GUARDIAN_VERIFICATION.md`](GUARDIAN_VERIFICATION.md),
ADR-017 and ADR-018.

## 3. The production safety gate

`library_settings.required_guardian_verification` — default `SELF_DECLARED`,
which is a development default and is labelled as one.

Checked at **approval** and again at **activation**, because the bar can be
raised while a request sits in the queue or an activation email sits unread, and
the accounts it was raised for must not walk under it.

**Absence of evidence is the weakest state, not an exemption.** No verification
record at all resolves to `NONE` and fails every requirement above `NONE`.

## 4. The photo lifecycle

`media_object.pending_deletion_at` makes every object either *claimed* or
*scheduled*, never merely forgotten. Bytes are written before the row exists and
deleted before the row is removed; a daily sweeper reconciles. A transaction and
an object-store write cannot be atomic, so instead both failure directions are
harmless. ADR-019, and [`MEDIA.md`](MEDIA.md) for the whole picture.

Metadata is stripped before storage — a phone photograph of a child usually
carries the GPS coordinates of their home, and none of it is needed to run a
library.

## 5. What the database now refuses

- A `SELF_DECLARED` method stored at `IDENTITY_PROVIDER` strength — one wrong
  literal in a service would otherwise sail through the production gate
- A verification attached to nobody
- A `VERIFIED` record with no timestamp
- A staff confirmation that does not name the staff member
- An `evidence_note` long enough to hide a document in

## 6. Two things found by doing rather than reading

**The existing suite caught the new gate immediately.** Four Phase 1 tests broke
because the fixture built members with no verification record — accounts no real
workflow could produce. The right fix was the fixture, not the rule.

**A header the code claimed but did not deliver.** The media route sets
`default-src 'none'; sandbox`, but `src/proxy.ts` was overwriting it with the
*page* CSP, so children's photographs were being served under the application's
script policy. Found by probing the live response in a browser; reading the route
file would never have shown it.

## 7. Verified

`252 tests` (107 unit, 145 against real PostgreSQL), typecheck, lint, production
build (20 routes), migration-drift check and gitleaks — all clean, all actually
run.

Walked in a browser on 17 August 2026: registration with and without a
photograph; the queue's two states and the development banner; approval carrying
the photo onto the card; photo replace and remove with the bytes checked on disk
each time; activation succeeding under dev mode; the gate closing when
`STAFF_VERIFIED` was required and reopening once a named librarian recorded a
confirmation; and a signed-in child getting `404` for another child's photograph,
byte-identical to an id that never existed.

## 8. Still open, and still the owner's call

1. **The consent wording has not been legally reviewed.** Unchanged, and still
   the top blocker before any real child's data is entered.
2. **What verification strength does production require?** Until someone
   qualified answers, the development banner stays up.
3. **Retention and reverification periods.** Still uninvented.
4. **`VERIFIED_IDENTITY_PROVIDER` is representable but not implemented** —
   configuring it fails closed.

## 9. Not started

Phase 2. No catalogue, no book search, no donations, no circulation. The
authentication architecture is unchanged, and nothing was weakened.
