import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The one question the book-intake form asks on the donor's behalf.
 *
 * The donors page is public, so what the librarian ticks at the desk decides
 * whether a neighbour's name appears on a page anybody can open. What the
 * *service* then does with that tick is covered against a real database in
 * `tests/database/donor-register.test.ts`, including the trap where saving an
 * untouched form would have republished a name.
 *
 * These are the two links in that chain that live in files a database test
 * cannot see: the checkbox exists and is off by default, and the action reads
 * it. Both are the kind of thing a later edit removes by accident, and the
 * failure is silent — a family's name on a public page.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

const FORM = read("src", "app", "admin", "books", "book-form.tsx");
const ACTION = read("src", "server", "actions", "catalogue-actions.ts");
const EDIT_PAGE = read("src", "app", "admin", "books", "[copyId]", "page.tsx");

describe("the do-not-publish tick box", () => {
  it("is on the intake form, as a checkbox", () => {
    expect(FORM).toContain('name="donorAnonymous"');
    expect(FORM).toMatch(/type="checkbox"/);
  });

  it("is off unless the family asked", () => {
    /*
     * The default is to say thank you by name. Asking every family to opt in
     * would leave the thank-you page empty, so this is the opt out -- and
     * `defaultChecked` must fall back to false rather than to anything derived
     * from a setting that could quietly flip it. A refused form restores the
     * tick as the librarian left it, which is the family's own answer being
     * carried across a failure -- but the last fallback is still false.
     */
    expect(FORM).toContain(
      "defaultChecked={kept?.donorAnonymous ?? values?.donorAnonymous ?? false}",
    );
  });

  it("says out loud what happens when it is left alone", () => {
    // A tick box whose label does not say what NOT ticking it does is a tick
    // box that gets left alone by a librarian who thinks it means "we did not
    // ask". The name goes on a public page; the wording has to say so.
    const prose = FORM.replace(/\s+/g, " ");
    expect(prose).toContain("Do not publish this name");
    expect(prose).toMatch(/thank-you page shows no name/i);
  });

  it("is read out of the submitted form", () => {
    // An unchecked box submits nothing at all, so presence is the test and a
    // missing field means "publish the name" — the library's default.
    expect(ACTION).toContain('formData.get("donorAnonymous") !== null');
  });

  it("comes back ticked when the family already asked", () => {
    // Otherwise a librarian opening the form to fix a spelling sees an unticked
    // box, saves, and puts the name back on the page.
    expect(EDIT_PAGE).toContain('donorAnonymous: book.donorDisplayConsent === "ANONYMOUS"');
  });

  it("never offers to set somebody's credit from a page a reader can see", () => {
    // The choice is recorded at the desk, by staff, on the book's own form.
    // There is no self-service control for it anywhere public.
    const donors = read("src", "app", "donors", "page.tsx");
    expect(donors).not.toContain("donorAnonymous");
    expect(donors).not.toContain("<form");
  });
});
