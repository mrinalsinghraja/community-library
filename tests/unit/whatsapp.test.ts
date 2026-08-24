import { describe, expect, it } from "vitest";

import {
  DONATE_BOOKS_MESSAGE,
  JOIN_HELP_MESSAGE,
  toWhatsAppNumber,
  whatsAppLink,
} from "@/lib/whatsapp";

/**
 * The help link.
 *
 * Two things are worth holding still here. A phone number is a field where
 * everybody uses their own punctuation, and an administrator pasting one the
 * way it is written on a noticeboard must not produce a dead button. And an
 * unset or unusable number must return null rather than a link — a button that
 * opens WhatsApp addressed to nobody is worse than no button.
 */

const NUMBER = "9663312707";

describe("reading a phone number an administrator typed", () => {
  it("accepts a bare local number and adds the country code", () => {
    // How it is written on a noticeboard, and what will be pasted.
    expect(toWhatsAppNumber(NUMBER)).toBe("919663312707");
  });

  it("accepts the same number written five other ways", () => {
    for (const written of [
      "+919663312707",
      "+91 96633 12707",
      "+91-96633-12707",
      "0091 9663312707",
      "(+91) 9663 312 707",
    ]) {
      expect(toWhatsAppNumber(written)).toBe("919663312707");
    }
  });

  it("does not add a country code to a number that already has one", () => {
    expect(toWhatsAppNumber("919663312707")).toBe("919663312707");
  });

  it("refuses something that cannot be a phone number", () => {
    for (const nonsense of ["", "   ", "call me", "12345", "9".repeat(20)]) {
      expect(toWhatsAppNumber(nonsense)).toBeNull();
    }
  });
});

describe("building the link", () => {
  it("opens a chat with the message already written", () => {
    const link = whatsAppLink(NUMBER, JOIN_HELP_MESSAGE);

    expect(link).toBe(
      "https://wa.me/919663312707?text=Hi%2C%20can%20you%20help%20me%20to%20create%20an%20account%20for%20my%20child%3F",
    );
  });

  it("escapes the message rather than trusting it in a URL", () => {
    const link = whatsAppLink(NUMBER, "Hi & help? #P-15");

    expect(link).toContain("%26");
    expect(link).toContain("%23");
    expect(link).not.toContain("#P-15");
  });

  it("returns nothing when the library has not set a number", () => {
    // The signal to render no help block at all.
    expect(whatsAppLink(null, JOIN_HELP_MESSAGE)).toBeNull();
    expect(whatsAppLink(undefined, JOIN_HELP_MESSAGE)).toBeNull();
    expect(whatsAppLink("", JOIN_HELP_MESSAGE)).toBeNull();
  });

  it("returns nothing when the number set cannot be dialled", () => {
    expect(whatsAppLink("front desk", JOIN_HELP_MESSAGE)).toBeNull();
  });

  it("asks for the child, not for the software", () => {
    // Somebody stuck does not know whether the problem is the form, the email
    // or the flat number, and should not have to say.
    expect(JOIN_HELP_MESSAGE).toMatch(/account for my child/i);
    expect(JOIN_HELP_MESSAGE).not.toMatch(/error|form|website|bug/i);
  });
});

describe("the message a neighbour offering books sends", () => {
  it("says what they have, not what the software is called", () => {
    expect(DONATE_BOOKS_MESSAGE).toMatch(/books/i);
    expect(DONATE_BOOKS_MESSAGE).toMatch(/give/i);
  });

  it("asks rather than commits", () => {
    /*
     * The whole argument of the donors page is that giving is voluntary.
     * Nobody should feel they have signed something by pressing a button, so
     * the sentence opens a conversation and leaves the family free to stop.
     */
    expect(DONATE_BOOKS_MESSAGE).toMatch(/would like to/i);
    expect(DONATE_BOOKS_MESSAGE).not.toMatch(/donat|pledge|commit/i);
  });

  it("is a different sentence from the one somebody stuck sends", () => {
    // Two people, two situations. One door, two messages through it.
    expect(DONATE_BOOKS_MESSAGE).not.toBe(JOIN_HELP_MESSAGE);
  });

  it("survives the trip into a URL", () => {
    const link = whatsAppLink(NUMBER, DONATE_BOOKS_MESSAGE);

    expect(link).toContain("https://wa.me/919663312707?text=");
    expect(link).not.toContain(" ");
  });
});
