import { existsSync } from "node:fs";
import { join } from "node:path";

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
  templates.registrationReceived(CONTEXT, {
    guardianName: "Asha",
    childName: "Aarav",
    borrowingPeriodDays: 14,
    maxActiveLoans: 2,
    venueName: "Yoga Room",
  }),
  templates.activation(CONTEXT, {
    guardianName: "Asha",
    childName: "Aarav",
    memberCode: "TST-R0042",
    activationUrl: "https://library.example.org/activate/TOKENVALUE",
    expiresInDays: 7,
    borrowingPeriodDays: 14,
    maxActiveLoans: 2,
    venueName: "Yoga Room",
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
      borrowingPeriodDays: 14,
      maxActiveLoans: 2,
      venueName: "Yoga Room",
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
    borrowingPeriodDays: 14,
    maxActiveLoans: 2,
    venueName: "Yoga Room",
  });

  it("welcomes the family and explains how the library works", () => {
    expect(rendered.subject).toContain("Welcome");
    expect(rendered.text).toContain("Sign-in ID (library card number): TST-R0042");
    expect(rendered.text).toContain("SIGNING IN FOR THE FIRST TIME");
    expect(rendered.text).toContain("Ask the librarian for this book");
    expect(rendered.text).toContain("I want to return this book");
    expect(rendered.text).toContain("up to 2 books at a time, for 14 days");
    expect(rendered.text).toContain("the Yoga Room");
    expect(rendered.text).toContain("https://library.example.org/guide");
    expect(rendered.text).toContain("Happy reading!");
  });

  it("shows screenshots from static files, never from the media route", () => {
    const images = [...rendered.html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]!);
    const shots = images.filter((src) => src.includes("/email/"));
    expect(shots.length).toBeGreaterThanOrEqual(3);
    for (const src of images) {
      expect(src).not.toContain("/api/media");
      expect(src.startsWith("https://library.example.org/")).toBe(true);
    }
    for (const src of shots) {
      const file = src.replace("https://library.example.org/", "public/");
      expect(existsSync(join(process.cwd(), file)), file).toBe(true);
    }
  });

  it("puts the set-up button before the guide", () => {
    expect(rendered.html.indexOf("Set up the account")).toBeLessThan(
      rendered.html.indexOf("Signing in for the first time"),
    );
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

// ---------------------------------------------------------------------------

describe("the library's mark on every message", () => {
  it("appears at the head of all of them", () => {
    for (const rendered of ALL) {
      expect(rendered.html).toContain("/brand/library-mark-email-v2.png");
    }
  });

  it("is a static file, not the authorization-gated branding upload", () => {
    /*
     * `settings.logoUrl` points at /api/media/[id], which checks permissions on
     * every request. An inbox cannot authenticate, so that image would be a
     * permanent broken box in every email the library ever sends.
     */
    for (const rendered of ALL) {
      expect(rendered.html).not.toContain("/api/media/");
    }
  });

  it("carries no token, so opening an email reports nothing about who did", () => {
    // A per-recipient image URL is a read receipt. This one is the same file
    // for everybody.
    const src = ALL[0].html.match(/src="([^"]*library-mark-email[^"]*)"/)?.[1] ?? "";

    expect(src).not.toMatch(/[?&]/);
    expect(src).toBe(`${CONTEXT.appUrl}/brand/library-mark-email-v2.png`);
  });

  it("falls back to the library's name when the image is blocked", () => {
    /*
     * The bug this closes. `alt=""` renders as a bare grey box in an inbox that
     * blocks external images -- which is the default in a great many of them,
     * and the setting most people never change. It looks like the library sent
     * something broken. The name reads as the name.
     */
    const escapedName = CONTEXT.libraryName.replace(/'/g, "&#39;");

    for (const rendered of ALL) {
      expect(rendered.html).toContain(`alt="${escapedName}"`);
      expect(rendered.html).not.toContain('alt=""');
    }
  });

  it("keeps the tag on one line, because sanitisers rewrite markup", () => {
    for (const rendered of ALL) {
      const tag = rendered.html.match(/<img[^>]*>/);
      expect(tag, "img tag should match on a single line").not.toBeNull();
    }
  });

  it("still reads correctly as plain text, with no image at all", () => {
    for (const rendered of ALL) {
      expect(rendered.text).not.toContain("library-mark");
      expect(rendered.text).not.toContain("<img");
    }
  });
});

describe("the borrowing thank-you", () => {
  const book = (title: string, coverCid: string | null) => ({
    title,
    copyCode: "TST-B0001",
    dueOn: "Friday 14 November 2026",
    coverCid,
  });

  const rendered = templates.loanIssued(CONTEXT, {
    guardianName: "Asha",
    childName: "Aarav",
    issued: [book("Matilda", "issued-0@library")],
    alsoOut: [book("Holes", null)],
  });

  it("thanks the family, names the book and its return date", () => {
    expect(rendered.subject).toBe("Thank you for borrowing Matilda — due back Friday 14 November 2026");
    expect(rendered.text).toContain("Aarav has just borrowed Matilda");
    expect(rendered.text).toContain("please return by Friday 14 November 2026");
    expect(rendered.text).toContain("Happy Reading!");
  });

  it("carries the cover inline and lists the other book at home", () => {
    expect(rendered.html).toContain('src="cid:issued-0@library"');
    expect(rendered.text).toContain("Also at home with Aarav");
    expect(rendered.text).toContain("Holes");
  });

  it("tells the family how to reach the librarian", () => {
    expect(rendered.text).toContain("library@example.invalid");
  });

  it("escapes a title", () => {
    const hostile = templates.loanIssued(CONTEXT, {
      guardianName: null,
      childName: "Aarav",
      issued: [book("<img src=x onerror=alert(1)>", null)],
      alsoOut: [],
    });
    expect(hostile.html).not.toContain("<img src=x");
  });
});

describe("the reminder", () => {
  const books = [
    { title: "Matilda", copyCode: "TST-B0001", dueOn: "Friday 14 November 2026", coverCid: "r-0@library" },
    { title: "Holes", copyCode: "TST-B0002", dueOn: "Friday 14 November 2026", coverCid: null },
  ];

  it("lists every book in one message, with covers", () => {
    const rendered = templates.loanReminder(CONTEXT, {
      subject: "s",
      sentence: "Aarav borrowed Matilda and Holes.",
      childName: "Aarav",
      books,
      overdue: false,
    });
    expect(rendered.html).toContain('src="cid:r-0@library"');
    expect(rendered.text).toContain("Matilda (TST-B0001)");
    expect(rendered.text).toContain("Holes (TST-B0002)");
  });

  it("asks a late book back and points at the librarian, with no consequence", () => {
    const rendered = templates.loanReminder(CONTEXT, {
      subject: "s",
      sentence: "Aarav borrowed Matilda.",
      childName: "Aarav",
      books: books.slice(0, 1),
      overdue: true,
    });
    expect(rendered.text).toContain("If there is any problem with the book");
    expect(rendered.text).toContain("library@example.invalid");
    expect(rendered.text).not.toMatch(/\b(fines?|fees?|penalty|charges?|nothing to pay)\b/i);
  });
});

describe("the registration-received email", () => {
  const rendered = templates.registrationReceived(CONTEXT, {
    guardianName: "Asha",
    childName: "Aarav",
    borrowingPeriodDays: 14,
    maxActiveLoans: 2,
    venueName: "Yoga Room",
  });

  it("says what happens next, with questions and links", () => {
    expect(rendered.subject).toContain("what happens next");
    expect(rendered.text).toContain("WHAT HAPPENS NEXT");
    expect(rendered.text).toContain("QUESTIONS PARENTS ASK");
    expect(rendered.text).toContain("Up to 2 books at a time, for 14 days");
    expect(rendered.text).toContain("the Yoga Room");
    for (const path of ["/guide", "/faq", "/rules", "/books", "/privacy"]) {
      expect(rendered.text).toContain(`https://library.example.org${path}`);
    }
  });

  it("carries no link that does anything to an account", () => {
    expect(rendered.text).not.toMatch(/\/(activate|reset|verify)\//);
  });

  it("shows screenshots that exist as static files", () => {
    const shots = [...rendered.html.matchAll(/<img[^>]+src="([^"]+\/email\/[^"]+)"/g)].map((m) => m[1]!);
    expect(shots.length).toBeGreaterThanOrEqual(3);
    for (const src of shots) {
      const file = src.replace("https://library.example.org/", "public/");
      expect(existsSync(join(process.cwd(), file)), file).toBe(true);
    }
  });

  it("promises nothing about lost or late books", () => {
    expect(rendered.text).not.toMatch(/\b(fines?|fees?|penalty|charged?|nothing happens)\b/i);
  });
});
