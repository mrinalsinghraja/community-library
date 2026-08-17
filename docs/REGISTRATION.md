# Registration

From a parent filling in a form to a child signing in.

---

## 1. The whole flow

```
Parent → /join
   │  six fields, an avatar, two consent boxes
   ▼
registration_request  status = PENDING          ← NO account exists yet
   │  guardian gets "we have your registration"
   │  consent_record rows written with the exact wording shown
   ▼
Librarian → /desk/registrations
   │  sees name, age, flat, guardian, contact, consent status
   ├─ Reject → status = REJECTED, internal reason required
   │           guardian gets a soft note; the reason never leaves the library
   ▼
   Approve  (one transaction)
   │  • app_user  kind=MEMBER  status=INVITED  no password
   │  • member_profile with card MJCL-R0042
   │  • guardian row (reused across siblings) + guardian_member link
   │  • consent_record re-pointed at the member and guardian
   │  • activation token minted
   │  • three audit rows
   ▼
Guardian email → /activate/<token>
   │  child chooses a secret word, with a grown-up
   ▼
app_user status = ACTIVE, must_set_password = false
   │
   ▼
Child signs in at /login with MJCL-R0042
```

The email is sent *after* the transaction commits, deliberately: a mail server
having a bad minute must not roll back an approval. If it fails, the librarian
sees so and can use **Send link again**.

## 2. What is collected

Required: child's name, date of birth, flat, guardian's name, email, phone.
Optional: an avatar (twelve to choose from; one is preselected).

That is the entire list. No school, no address beyond the flat, no demographics,
no second parent, no emergency contact. See `SECURITY.md` §2.

## 3. Age

Checked against `library_settings.age_min` / `age_max` — never a literal — and
checked **twice**: at submission, and again at approval, because a request can
sit in the queue while an administrator changes the range. Both have tests.

An out-of-range submission is the one rejection told plainly to the parent:

> Our library is for readers aged 5 to 14. We would still love to see you — do
> come and talk to the librarian.

It concerns their own child, reveals nothing about anyone else, and silently
swallowing it would leave a family waiting for an approval that never comes.

## 4. What the form does not reveal

A duplicate submission — same child, same flat, case- and whitespace-insensitive
— is **silently accepted** and creates nothing. The response is byte-identical
to a first submission.

Otherwise `/join` would answer "is this child already a member here?" for
anyone who cared to ask. The database enforces it with a partial unique index;
the service catches the violation and returns success.

Rate limiting (5/hour/IP) and a honeypot field are also silent: a bot that
fills the hidden field gets the same cheerful thank-you page.

## 5. The librarian's queue

`/desk/registrations` shows only what a decision needs: name, age with an
in-range indicator, flat, guardian name, guardian contact, submitted time, and
whether consent was recorded.

**Approve** is one click — the common case, often with a child waiting.
**Reject** asks for an internal reason first (minimum three characters). That
reason goes to the audit log and `review_note`. It is never emailed, and a test
asserts the rejection email does not contain it.

## 6. Photographs

Version 1 ships **avatars only** in the registration form.

The upload pipeline exists and is tested — magic-byte sniffing, size caps,
executable rejection, random storage keys, a private-by-construction storage
driver, and a database CHECK forbidding a public URL on a private object — but
the form does not yet offer a file input.

This is a deliberate sequencing choice, not an omission: photographs of children
are the most sensitive thing this system could hold, and turning them on wants
the consent wording reviewed first (`CONSENT.md` §1). `CHILD_PHOTO_STORAGE`
consent is already modelled and will be required at the moment the field appears.

## 7. Where the code is

| Concern | File |
|---|---|
| Business rules | `src/server/services/registration-service.ts` |
| Form parsing | `src/server/actions/registration-actions.ts` |
| Public form | `src/app/join/join-form.tsx` |
| Librarian queue | `src/app/desk/registrations/` |
| Tests | `tests/database/registration.test.ts` (16) |
