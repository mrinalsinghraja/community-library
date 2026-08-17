import { describe, expect, it } from "vitest";

import * as templates from "@/server/lib/email/templates";
import type { EmailContext } from "@/server/lib/email/types";

/**
 * Email templates.
 *
 * The rules being enforced: no password ever appears, the only secret is a
 * single-use link, one family's details never appear in another's message, and
 * internal notes stay internal.
 */

const CONTEXT: EmailContext = {
  libraryName: "Test Children's Library",
  communityName: "Test Community",
  appUrl: "https://library.example.org",
  contactEmail: "library@example.invalid",
};

const ALL = [
  templates.registrationReceived(CONTEXT, { guardianName: "Asha", childName: "Aarav" }),
  templates.activation(CONTEXT, {
    guardianName: "Asha",
    childName: "Aarav",
    memberCode: "TST-R0042",
    activationUrl: "https://library.example.org/activate/TOKENVALUE",
    expiresInDays: 7,
  }),
  templates.staffInvitation(CONTEXT, {
    name: "Priya",
    roleName: "a Librarian",
    activationUrl: "https://library.example.org/activate/TOKENVALUE",
    expiresInDays: 7,
  }),
  templates.registrationRejected(CONTEXT, { guardianName: "Asha", childName: "Aarav" }),
  templates.passwordReset(CONTEXT, {
    childName: "Aarav",
    resetUrl: "https://library.example.org/reset/TOKENVALUE",
    expiresInHours: 2,
  }),
  templates.passwordChanged(CONTEXT, { childName: "Aarav" }),
  templates.accountSuspended(CONTEXT, { childName: "Aarav" }),
  templates.accountReactivated(CONTEXT, { childName: "Aarav" }),
];

describe("every template", () => {
  it("has a subject, an HTML body and a plain-text body", () => {
    for (const rendered of ALL) {
      expect(rendered.subject.length).toBeGreaterThan(5);
      expect(rendered.html).toContain("<html");
      expect(rendered.text.length).toBeGreaterThan(20);
    }
  });

  it("never contains anything that looks like a password", () => {
    for (const rendered of ALL) {
      const body = `${rendered.subject} ${rendered.text}`.toLowerCase();
      expect(body).not.toMatch(/your password is/);
      expect(body).not.toMatch(/temporary password/);
      expect(body).not.toMatch(/password:\s*\S/);
    }
  });

  it("carries the library's name from configuration, not a hard-coded one", () => {
    for (const rendered of ALL) {
      const body = `${rendered.subject} ${rendered.text}`;
      expect(body).toContain("Test Children's Library");
    }
  });

  it("escapes interpolated names so a name cannot inject markup", () => {
    const rendered = templates.registrationReceived(CONTEXT, {
      guardianName: '<script>alert("x")</script>',
      childName: "Bobby </p><img src=x onerror=alert(1)>",
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});

describe("the activation email", () => {
  const rendered = templates.activation(CONTEXT, {
    guardianName: "Asha",
    childName: "Aarav",
    memberCode: "TST-R0042",
    activationUrl: "https://library.example.org/activate/TOKENVALUE",
    expiresInDays: 7,
  });

  it("is addressed to the guardian, not to the child", () => {
    // A six-year-old is not responsible for account security.
    expect(rendered.text).toContain("Dear Asha");
  });

  it("carries the link and the card number, and says the link expires", () => {
    expect(rendered.text).toContain("https://library.example.org/activate/TOKENVALUE");
    expect(rendered.text).toContain("TST-R0042");
    expect(rendered.text).toMatch(/expires in 7 days/i);
  });

  it("states plainly that the library cannot see the password", () => {
    expect(rendered.text.toLowerCase()).toContain("nobody at the library can see");
  });

  it("appears in both the HTML and the plain-text part", () => {
    expect(rendered.html).toContain("https://library.example.org/activate/TOKENVALUE");
  });
});

describe("the rejection email", () => {
  it("never carries the internal reason", () => {
    // The librarian's note is for the library. The family gets an invitation to
    // come and talk, not a verdict.
    const rendered = templates.registrationRejected(CONTEXT, {
      guardianName: "Asha",
      childName: "Aarav",
    });

    expect(rendered.text.toLowerCase()).toContain("librarian");
    expect(rendered.text).not.toMatch(/because|reason|rejected because/i);
  });
});

describe("the suspension email", () => {
  it("says the account is paused without saying why", () => {
    const rendered = templates.accountSuspended(CONTEXT, { childName: "Aarav" });

    expect(rendered.text.toLowerCase()).toContain("paused");
    expect(rendered.text.toLowerCase()).toContain("librarian");
    // No internal note, no accusation, no detail.
    expect(rendered.text).not.toMatch(/reason|violation|breach|misuse/i);
  });
});

describe("the staff invitation", () => {
  it("does not tell a new librarian that their child is a member", () => {
    // It used to reuse the activation template, which produced nonsense.
    const rendered = templates.staffInvitation(CONTEXT, {
      name: "Priya",
      roleName: "a Librarian",
      activationUrl: "https://library.example.org/activate/TOKENVALUE",
      expiresInDays: 7,
    });

    expect(rendered.text).toContain("Hello Priya");
    expect(rendered.text).not.toMatch(/library card|your child/i);
    expect(rendered.text).toContain("a Librarian");
  });

  it("reminds staff what they are being trusted with", () => {
    const rendered = templates.staffInvitation(CONTEXT, {
      name: "Priya",
      roleName: "a Librarian",
      activationUrl: "https://library.example.org/activate/TOKENVALUE",
      expiresInDays: 7,
    });

    expect(rendered.text.toLowerCase()).toContain("children's personal information");
  });
});
