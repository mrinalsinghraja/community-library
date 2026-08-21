import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The transport layer, which had never been exercised because it had never been
 * switched on.
 *
 * For most of this library's life `EMAIL_PROVIDER` was unset, which means
 * `console`, which in production means the refusing provider — so every
 * activation link the library ever issued was recorded FAILED and nobody was
 * ever written to. Turning it on made three things worth pinning down:
 *
 *   1. **The refusal is deliberate and stays.** A production deployment with no
 *      transport must keep saying so rather than quietly capturing to a
 *      filesystem nobody reads.
 *   2. **STARTTLS is not guessed wrong.** The old default sent `secure: true`
 *      to port 587, and that failure does not announce itself — it reads as a
 *      timeout, which is the hardest kind of misconfiguration to find.
 *   3. **A provider error never carries the message body back.** The body is an
 *      activation link, and a rejected payload is frequently echoed in full.
 */

const ENV: Record<string, unknown> = {
  BREVO_API_KEY: "test-key",
  EMAIL_FROM: "Test Library <library@example.invalid>",
  EMAIL_REPLY_TO: undefined,
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASSWORD: undefined,
  SMTP_SECURE: null,
  RESEND_API_KEY: undefined,
  EMAIL_PROVIDER: "brevo",
  NODE_ENV: "test",
};

vi.mock("@/server/env", () => ({
  get env() {
    return ENV;
  },
  isProduction: false,
  isTest: true,
}));

const {
  BrevoEmailProvider,
  CaptureEmailProvider,
  RefusingEmailProvider,
  ResendEmailProvider,
  SmtpEmailProvider,
  parseSender,
  selectEmailProvider,
  smtpUsesImplicitTls,
} = await import("@/server/lib/email/providers");

afterEach(() => {
  vi.unstubAllGlobals();
  ENV.BREVO_API_KEY = "test-key";
  ENV.EMAIL_FROM = "Test Library <library@example.invalid>";
  ENV.EMAIL_REPLY_TO = undefined;
});

const MESSAGE = {
  to: "guardian@example.invalid",
  subject: "Your library account",
  html: "<p>https://library.example.org/activate/SECRETTOKEN</p>",
  text: "https://library.example.org/activate/SECRETTOKEN",
  template: "activation",
};

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const spy = vi.fn(async () => response as Response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

// ---------------------------------------------------------------------------

describe("choosing a transport", () => {
  it("refuses to send in production when nothing is configured", () => {
    /*
     * The bug that kept this library silent for weeks, kept as a test. A
     * deployment with no EMAIL_PROVIDER must not fall back to the capture
     * transport: that returns ok, writes SENT to the delivery log, and leaves a
     * family waiting for a link that went to an ephemeral disk.
     */
    expect(selectEmailProvider("console", true)).toBeInstanceOf(RefusingEmailProvider);
  });

  it("captures to disk on a laptop", () => {
    expect(selectEmailProvider("console", false)).toBeInstanceOf(CaptureEmailProvider);
  });

  it("uses the HTTP transport for brevo, in production and out of it", () => {
    expect(selectEmailProvider("brevo", true)).toBeInstanceOf(BrevoEmailProvider);
    expect(selectEmailProvider("brevo", false)).toBeInstanceOf(BrevoEmailProvider);
  });

  it("still offers the two transports that were already here", () => {
    expect(selectEmailProvider("smtp", true)).toBeInstanceOf(SmtpEmailProvider);
    expect(selectEmailProvider("resend", true)).toBeInstanceOf(ResendEmailProvider);
  });

  it("names the refusal after the configuration, not after the weather", async () => {
    const result = await new RefusingEmailProvider().send();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("EMAIL_PROVIDER=console");
  });
});

// ---------------------------------------------------------------------------

describe("which port speaks TLS first", () => {
  it("treats 465 as implicit TLS and everything else as STARTTLS", () => {
    expect(smtpUsesImplicitTls(null, 465)).toBe(true);
    expect(smtpUsesImplicitTls(null, 587)).toBe(false);
    expect(smtpUsesImplicitTls(null, 2525)).toBe(false);
    expect(smtpUsesImplicitTls(null, 25)).toBe(false);
  });

  it("lets an explicit setting win either way", () => {
    // Some relays do publish implicit TLS on a non-standard port, and the
    // operator has to be able to say so.
    expect(smtpUsesImplicitTls(true, 587)).toBe(true);
    expect(smtpUsesImplicitTls(false, 465)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("splitting the From address", () => {
  it("takes a bare address", () => {
    expect(parseSender("library@example.invalid")).toEqual({ email: "library@example.invalid" });
  });

  it("takes the display-name form the SMTP transport also accepts", () => {
    expect(parseSender("Test Library <library@example.invalid>")).toEqual({
      email: "library@example.invalid",
      name: "Test Library",
    });
  });

  it("unwraps a quoted display name", () => {
    expect(parseSender('"Test Library" <library@example.invalid>')).toEqual({
      email: "library@example.invalid",
      name: "Test Library",
    });
  });

  it("omits an empty display name rather than sending one", () => {
    expect(parseSender("<library@example.invalid>")).toEqual({ email: "library@example.invalid" });
  });
});

// ---------------------------------------------------------------------------

describe("the HTTP transport", () => {
  it("sends the message and reports the provider's id", async () => {
    const fetchSpy = stubFetch({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "<abc@brevo>" }),
    });

    const result = await new BrevoEmailProvider().send(MESSAGE);

    expect(result).toEqual({ ok: true, providerMessageId: "<abc@brevo>" });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    const body = JSON.parse(String(init.body));
    expect(body.sender).toEqual({ email: "library@example.invalid", name: "Test Library" });
    expect(body.to).toEqual([{ email: "guardian@example.invalid" }]);
    expect(body.subject).toBe("Your library account");
  });

  it("leaves replyTo out entirely when there is none to send", async () => {
    const fetchSpy = stubFetch({ ok: true, status: 201, json: async () => ({ messageId: "x" }) });

    await new BrevoEmailProvider().send(MESSAGE);

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("replyTo");
  });

  it("never carries the message body back in the error", async () => {
    /*
     * The rule that matters most here. A provider that rejects a payload very
     * often echoes it, and the payload is a single-use activation link — which
     * would then be written to the delivery log and to the console.
     */
    stubFetch({
      ok: false,
      status: 400,
      json: async () => ({
        code: "invalid_parameter",
        message: `Rejected: ${MESSAGE.html}`,
        payload: MESSAGE,
      }),
    });

    const result = await new BrevoEmailProvider().send(MESSAGE);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Brevo responded 400 (invalid_parameter)");
    expect(result.error).not.toContain("SECRETTOKEN");
    expect(result.error).not.toContain("activate");
  });

  it("still says something useful when the provider sends no code", async () => {
    stubFetch({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error("not json");
      },
    });

    const result = await new BrevoEmailProvider().send(MESSAGE);
    expect(result.error).toBe("Brevo responded 503");
  });

  it("reports a missing key rather than throwing into the workflow", async () => {
    // A failed send has never been allowed to roll back the thing that
    // triggered it: approving a registration still approves it.
    ENV.BREVO_API_KEY = undefined;

    await expect(new BrevoEmailProvider().send(MESSAGE)).resolves.toEqual({
      ok: false,
      error: "BREVO_API_KEY is not configured",
    });
  });

  it("reports a missing From address the same way", async () => {
    ENV.EMAIL_FROM = undefined;

    await expect(new BrevoEmailProvider().send(MESSAGE)).resolves.toEqual({
      ok: false,
      error: "EMAIL_FROM is not configured",
    });
  });

  it("turns a network failure into a recorded failure, not a thrown one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.brevo.com");
      }),
    );

    const result = await new BrevoEmailProvider().send(MESSAGE);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOTFOUND");
  });
});
