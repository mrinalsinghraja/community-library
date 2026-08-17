import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { env } from "@/server/env";
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

/** SMTP, via nodemailer. Loaded lazily so the dependency is not pulled in unused. */
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
      secure: env.SMTP_SECURE,
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

export function createEmailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case "smtp":
      return new SmtpEmailProvider();
    case "resend":
      return new ResendEmailProvider();
    case "console":
    default:
      return new CaptureEmailProvider();
  }
}
