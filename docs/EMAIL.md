# Email

---

## 1. Shape

```
services  ──►  EmailService.sendActivation(...)      ← all business logic stops here
                     │
                     ├─ writes an email_event row (QUEUED)
                     ├─ renders a template with branding from settings
                     ├─ hands an EmailMessage to the configured provider
                     └─ updates email_event (SENT | FAILED)
                                │
                 ┌──────────────┼──────────────┐
        CaptureProvider    SmtpProvider   ResendProvider
        (development)      (nodemailer)   (HTTP API)
```

No service knows SMTP exists. Adding a provider is one file implementing
`EmailProvider`; switching provider is one environment variable.

## 2. Guarantees

**Every attempt is logged.** `email_event` records recipient, template, subject,
status, provider message id and any error. "Did the guardian ever get the
activation link?" is answerable from the database.

**A delivery failure never throws into the caller.** Approving a registration
must not roll back because a mail server was briefly unreachable. The approval
commits, the failure is recorded, and the librarian sees a message pointing at
**Send link again**.

**Nothing that could authenticate someone is ever logged.** Not the body, not
the link, not the token. The capture provider logs only recipient and subject —
a link in a log file is a link that has leaked. Provider errors are stored as a
message or a status code, never the echoed payload.

## 3. Templates

| Template | To | Sent when |
|---|---|---|
| `registration_received` | guardian | a registration is submitted |
| `activation` | guardian | a registration is approved |
| `staff_invitation` | staff member | a staff account is created |
| `registration_rejected` | guardian | a registration is rejected |
| `password_reset` | guardian (or staff themselves) | a reset is requested |
| `password_changed` | guardian | the password changed |
| `account_suspended` | guardian | an account is paused |
| `account_reactivated` | guardian | an account is un-paused |
| `important_notification` | anyone | general-purpose |

**Tone: written to the parent, never to the child.** A six-year-old is not
responsible for account security, and an email that talks to them as though they
were would be both confusing and wrong.

Rules with tests behind them:

- No password appears in any template, ever — not even a temporary one.
- The only secret is a single-use, time-limited link.
- Internal notes stay internal: the rejection email does not carry the
  librarian's reason, and the suspension email does not say why.
- Names are HTML-escaped, so a name cannot inject markup.
- The library's name comes from configuration.
- The staff invitation is its own template — reusing the activation one told new
  librarians their child had become a member.

## 4. Development

`EMAIL_PROVIDER=console` (the default) writes each message to `.mail/` as an
`.html` and a `.json` file and logs one line. **No socket is opened**, so nothing
can reach a real family from a developer's laptop.

`/dev/mail` renders that directory as a browsable inbox with the live links
clickable — the whole activation flow can be walked without configuring email at
all. The route returns **404 in production, unconditionally**: captured mail
contains live activation links, and a page listing them must not exist on the
internet.

`.mail/` is gitignored.

## 5. Production

The transport is **Brevo, over its HTTP API** (`EMAIL_PROVIDER=brevo`). `smtp`
and `resend` remain and are tested; nothing about the services above changes if
the choice changes.

Why HTTP and not a socket: every send happens inside a serverless function. An
HTTP request either returns or does not. An SMTP send has to open a TCP
connection, negotiate TLS, authenticate and close cleanly before the function is
allowed to finish, on a runtime designed to be killed mid-flight — and it puts
the recipient's address into a command stream, which is the injection surface
nodemailer keeps publishing advisories about.

Why a free tier is the right tier here, not a compromise: the free allowance is
a **daily** one, and a building-sized library's mail is bursty but small —
activation links go out when a set of families is approved together, and there
is no month in which that reaches the ceiling. There is nothing to outgrow until
the library is several buildings.

### Setting it up

1. Create the sending account. In the dashboard, take an **SMTP & API key**.
2. Authorise the sending identity. Either verify a single sender address, which
   takes one click in that mailbox, or authenticate a domain by publishing the
   DKIM and SPF records the dashboard gives you. **Prefer the domain.**
3. Set, in the deployment's production environment:
   `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY=…`, `EMAIL_FROM=…`, and optionally
   `EMAIL_REPLY_TO=…`. `EMAIL_FROM` must be the address or domain from step 2 —
   an unverified sender is refused with `sender_not_valid`, which the settings
   page will show verbatim.
4. Redeploy, then press **Send a test to myself** on `/admin/settings`.

**SPF and DKIM are not optional.** Without them, activation links land in spam
and no family can complete registration — which fails silently, the worst kind
of failure. Sending as a `@gmail.com` address through any relay fails alignment
by construction, however verified the sender is: use a domain you control.

`EMAIL_FROM` should be a real, monitored address. `EMAIL_REPLY_TO` can point at
the librarian.

### Finding out whether it works

`/admin/settings` names the transport in force, the last message that actually
went out, and how many failed in the past week. **Send a test to myself** sends
one message to the signed-in administrator's own address — the recipient is not
a parameter anywhere in the chain, so no request can point it at a family — and
shows the provider's own error text on failure, because "could not send" is not
something a librarian can act on and `sender_not_valid` is.

It exists because the only other way to test the transport was to issue somebody
a real activation link and watch, which spends a single-use token to answer a
question about configuration, and spends it on a family who is waiting for it.
Five per administrator per hour: a transport that is misconfigured stays
misconfigured, and each test comes out of the same daily allowance the families'
links do.

### The failure this deployment actually had

No email variable was ever set in production. `EMAIL_PROVIDER` therefore
defaulted to `console`, which in production is the refusing transport — so every
message the library ever tried to send was recorded FAILED and nobody was
written to. The refusal was correct and is deliberately kept (ADR-047); what was
missing was any surface that said so, which is what the settings card is for.

## 6. Circulation reminders

Due-soon reminders and overdue nudges were built in **Phase 4** and run in the
daily cron. Two templates — `loan_due_soon` and `loan_overdue` — both to the
guardian, both governed by `overdue_reminders_enabled` (off by default).

**They are off here and stay off** until a production provider, a sending
domain, SPF and DKIM, and the consent questions are all settled — ADR-032. Until
then every reminder is captured to `.mail/` and read at `/dev/mail`, which is
correct for development and means nothing reaches a family.

They are the only mail this system sends that nobody asked for by taking an
action, which is why the duplicate-suppression design is worth reading before
changing anything: **`docs/NOTIFICATIONS.md`**.

## 7. Not built yet

In-app notifications; WhatsApp; SMS; return confirmations; any message about a
renewal request being decided. The blueprint's pluggable `NotificationService`
is not built either — there is one channel, and an abstraction with nothing to
hold is a shape, not a design.


---

## Turning reminders on

Since Phase 5, `overdue_reminders_enabled` is changed on `/admin/settings` by a
Super Admin rather than by an `UPDATE`. The screen renders **no control** while
`EMAIL_PROVIDER=console`, and `setOverdueReminders(true)` refuses regardless of
what reaches it — a mail transport that captures to `.mail/` cannot reach a
family, and a librarian must never be told "saved" about a message nobody will
get.

The other three preconditions from ADR-032 — a sending domain, SPF/DKIM, and the
consent decisions — are not enforced in code, because a server cannot check them.
They are the operator's, and they are listed in `SETTINGS.md` and `DEPLOYMENT.md`.
