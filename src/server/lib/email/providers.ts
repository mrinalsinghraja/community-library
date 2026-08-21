import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { env, isProduction } from "@/server/env";
import type { EmailMessage, EmailProvider, EmailSendResult } from "@/server/lib/email/types";

/**
 * Providers.
 *
 * The development provider is the important one: it captures mail to disk so
 * that nothing addressed to a real family can escape a developer's laptop. The
 * only way to send a real email is to deliberately configure a real provider.
 */

/** Where the development provider writes captured mail. Gitignored. */
export const MAIL_CAPTURE_DIR = ".mail";

/**
 * Development transport. Writes each message to `.mail/` and logs a one-line
 * summary. Never opens a socket, so it cannot deliver to a real address.
 */
export class CaptureEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const id = `${Date.now()}-${message.template}`;

    try {
      await mkdir(MAIL_CAPTURE_DIR, { recursive: true });

      await writeFile(join(MAIL_CAPTURE_DIR, `${id}.html`), message.html, "utf8");
      await writeFile(
        join(MAIL_CAPTURE_DIR, `${id}.json`),
        JSON.stringify(
          {
            id,
            capturedAt: new Date().toISOString(),
            to: message.to,
            subject: message.subject,
            template: message.template,
            text: message.text,
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch (error) {
      // Capturing is best effort. A read-only filesystem must not break the
      // workflow that triggered the email.
      console.warn(`[email] could not capture message to ${MAIL_CAPTURE_DIR}:`, error);
    }

    // Subject and recipient only. The body can contain an activation link, and
    // a link in a log file is a link that has leaked.
    console.info(`[email:captured] to=${message.to} subject="${message.subject}" id=${id}`);

    return { ok: true, providerMessageId: id };
  }
}

/**
 * Whether to open the socket in TLS immediately.
 *
 * Explicit setting wins. Otherwise 465 is the implicit-TLS port and everything
 * else (587, 2525, 25) speaks STARTTLS. Getting this wrong does not produce an
 * error that says so: the client waits for a TLS server hello that a plaintext
 * port will never send, and the library sees a timeout.
 */
export function smtpUsesImplicitTls(secure: boolean | null, port: number): boolean {
  return secure ?? port === 465;
}

/**
 * SMTP, via nodemailer. Loaded lazily so the dependency is not pulled in unused.
 *
 * Kept as the escape hatch for any relay with a hostname, but it is not the
 * transport this deployment reaches for first: a serverless function pays a TCP
 * handshake, a TLS negotiation and an AUTH round trip on every single message,
 * and it holds an outbound socket open in an environment designed to be killed
 * mid-flight. `BrevoEmailProvider` does the same job in one POST.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { createTransport } = await import("nodemailer");

    if (!env.SMTP_HOST || !env.SMTP_PORT) {
      return { ok: false, error: "SMTP_HOST and SMTP_PORT are required" };
    }

    const transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: smtpUsesImplicitTls(env.SMTP_SECURE, env.SMTP_PORT),
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });

    try {
      const info = await transport.sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        replyTo: message.replyTo ?? env.EMAIL_REPLY_TO,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { ok: true, providerMessageId: info.messageId };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }
}

/**
 * Splits `EMAIL_FROM` into the two fields an HTTP mail API wants.
 *
 * Accepts both the bare address and the `Display Name <address>` form, because
 * the same variable is handed unchanged to nodemailer, which accepts both.
 */
export function parseSender(from: string): { email: string; name?: string } {
  const angled = /^\s*(.*?)\s*<\s*([^<>]+?)\s*>\s*$/.exec(from);
  if (!angled) return { email: from.trim() };

  const name = angled[1].replace(/^"|"$/g, "").trim();
  return name ? { email: angled[2], name } : { email: angled[2] };
}

/**
 * Brevo, over its transactional HTTP API.
 *
 * The default for this deployment, and the reason is the runtime rather than
 * the vendor. Every send here happens inside a serverless function: one `fetch`
 * that either returns or does not is a far better fit than a socket that has to
 * be opened, negotiated, authenticated and closed before the function is
 * allowed to finish. It also keeps the recipient address away from an SMTP
 * command stream entirely.
 *
 * The free tier is a daily allowance rather than a trial, which is what a
 * building-sized library needs: activation links arrive in bursts when a set of
 * families is approved together, and there is no month in which that adds up.
 */
export class BrevoEmailProvider implements EmailProvider {
  readonly name = "brevo";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!env.BREVO_API_KEY) return { ok: false, error: "BREVO_API_KEY is not configured" };
    if (!env.EMAIL_FROM) return { ok: false, error: "EMAIL_FROM is not configured" };

    const replyTo = message.replyTo ?? env.EMAIL_REPLY_TO;

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": env.BREVO_API_KEY,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: parseSender(env.EMAIL_FROM),
          to: [{ email: message.to }],
          ...(replyTo ? { replyTo: { email: replyTo } } : {}),
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
      });

      if (!response.ok) {
        /*
         * Status and the provider's own error code, never the body. A rejected
         * payload is frequently echoed back in full, and the payload is an
         * activation link. The code is what makes the failure actionable —
         * `unauthorized` is a wrong key, `sender_not_valid` is an unverified
         * From address, and those need different people to fix them.
         */
        const detail = await readErrorDetail(response);
        return { ok: false, error: `Brevo responded ${response.status}${detail}` };
      }

      const body = (await response.json()) as { messageId?: string };
      return { ok: true, providerMessageId: body.messageId };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }
}

/**
 * What went wrong, in the provider's own words, without the body.
 *
 * The code alone is not enough for an authentication failure: Brevo answers
 * `unauthorized` to a revoked key, to a key that is real but sent from an IP the
 * account has not allowlisted, and to an account that has not been validated for
 * transactional sending. Three different people fix those three things, and the
 * `message` field is the only thing that separates them.
 *
 * The message is included **only for 401 and 403**. An authentication failure is
 * rejected before the payload is looked at, so its message cannot contain the
 * payload — whereas a 400 validation error very often echoes the offending
 * field, and the payload here holds an activation link. Everything else stays
 * code-only, and the message is capped.
 */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    const code = typeof body.code === "string" ? body.code.slice(0, 60) : "";

    const authFailure = response.status === 401 || response.status === 403;
    const message =
      authFailure && typeof body.message === "string" ? body.message.slice(0, 200) : "";

    const parts = [code, message].filter(Boolean);
    return parts.length ? ` (${parts.join(": ")})` : "";
  } catch {
    return "";
  }
}

/** Resend, over its HTTP API — no SDK dependency needed. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!env.RESEND_API_KEY) {
      return { ok: false, error: "RESEND_API_KEY is not configured" };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          reply_to: message.replyTo ?? env.EMAIL_REPLY_TO,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!response.ok) {
        // Status only. A provider error body can echo the payload back, and the
        // payload contains the activation link.
        return { ok: false, error: `Resend responded ${response.status}` };
      }

      const body = (await response.json()) as { id?: string };
      return { ok: true, providerMessageId: body.id };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }
}

/** Error text safe to store: a message, never a stack or a payload echo. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unknown email transport error";
}

/**
 * What `console` means once the application is deployed: nothing may be sent.
 *
 * The capture transport opens no socket. On a laptop that is the point. In
 * production it would write every activation link, guardian verification and
 * password reset to an ephemeral filesystem nobody reads, return `ok`, and
 * leave `email_event` saying SENT — so a family would wait for an email that
 * was never going anywhere and the delivery log would agree it had arrived.
 * A library that cannot onboard a child and cannot tell is the worst outcome
 * available here, so this refuses instead.
 *
 * It refuses rather than throws because a delivery failure has never been
 * allowed to roll back the workflow that triggered it: approving a
 * registration must still approve it. The attempt is recorded FAILED, with a
 * reason that names the configuration.
 */
export class RefusingEmailProvider implements EmailProvider {
  readonly name = "refusing";

  async send(): Promise<EmailSendResult> {
    return {
      ok: false,
      error:
        "No email transport is configured for production (EMAIL_PROVIDER=console), so nothing was sent",
    };
  }
}

/**
 * Chooses the transport. Split from `createEmailProvider` so the production
 * rule can be tested without a production process.
 */
export function selectEmailProvider(
  provider: typeof env.EMAIL_PROVIDER,
  production: boolean,
): EmailProvider {
  switch (provider) {
    case "brevo":
      return new BrevoEmailProvider();
    case "smtp":
      return new SmtpEmailProvider();
    case "resend":
      return new ResendEmailProvider();
    case "console":
    default:
      return production ? new RefusingEmailProvider() : new CaptureEmailProvider();
  }
}

export function createEmailProvider(): EmailProvider {
  return selectEmailProvider(env.EMAIL_PROVIDER, isProduction);
}
