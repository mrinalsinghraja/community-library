import type { EmailMessage, EmailProvider, EmailSendResult } from "@/server/lib/email/types";

/**
 * An email provider that records instead of sending.
 *
 * Two jobs: let tests assert who was written to and what the message said, and
 * guarantee that no test can ever put a real address on a real wire.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly name = "fake";
  readonly sent: EmailMessage[] = [];

  /** When true, every send reports failure — for testing the unhappy path. */
  failNext = false;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: "simulated transport failure" };
    }
    return { ok: true, providerMessageId: `fake-${this.sent.length}` };
  }

  reset(): void {
    this.sent.length = 0;
    this.failNext = false;
  }

  lastTo(template?: string): EmailMessage | undefined {
    const matching = template
      ? this.sent.filter((message) => message.template === template)
      : this.sent;
    return matching.at(-1);
  }

  /** Extracts the single-use link from the most recent message of a template. */
  linkFrom(template: string): string | null {
    const message = this.lastTo(template);
    if (!message) return null;
    return message.text.match(/https?:\/\/\S+/)?.[0] ?? null;
  }

  tokenFrom(template: string): string | null {
    const link = this.linkFrom(template);
    return link ? (link.split("/").pop() ?? null) : null;
  }
}
