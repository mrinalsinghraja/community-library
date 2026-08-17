import "server-only";

/**
 * The email boundary.
 *
 * Business logic knows about `EmailService.sendActivation(...)`. It does not
 * know that SMTP exists. Swapping provider is an environment variable, and
 * adding one is a new file implementing this interface — no service changes.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Template identifier, recorded on the delivery log. */
  template: string;
  replyTo?: string;
}

export interface EmailSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Branding and links for templates. Always resolved from library settings, so
 * an email says the library's own name without any template knowing it.
 */
export interface EmailContext {
  libraryName: string;
  communityName: string;
  appUrl: string;
  contactEmail: string | null;
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}
