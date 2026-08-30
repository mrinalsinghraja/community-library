import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A refused form comes back the way it was left.
 *
 * React clears an uncontrolled form once its action returns. Both of these
 * forms were built with `defaultValue`s that came only from the database — the
 * book form's from the book being edited, the join form's from nowhere at all —
 * so any refusal emptied them. A librarian retyped ten fields because one
 * picture was the wrong size; a parent on a phone retyped six because of one
 * character in an email.
 *
 * The fix is the action handing the submitted answers back, and the form
 * preferring those over what it started with. These pin both halves, in the
 * files a database test cannot see.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

const BOOK_FORM = read("src", "app", "admin", "books", "book-form.tsx");
const BOOK_ACTION = read("src", "server", "actions", "catalogue-actions.ts");
const JOIN_FORM = read("src", "app", "join", "join-form.tsx");
const JOIN_ACTION = read("src", "server", "actions", "registration-actions.ts");

describe("the book form", () => {
  it("is handed back what was typed", () => {
    expect(BOOK_ACTION).toContain("function readSubmission(formData: FormData)");
    expect(BOOK_ACTION).toMatch(/values\?:\s*BookFormSubmission/);
  });

  it("prefers what was typed over what the database holds", () => {
    expect(BOOK_FORM).toContain("kept?.[key] ?? values?.[key]");
  });

  it.each([
    "title",
    "author",
    "categoryId",
    "ageGroup",
    "condition",
    "status",
    "donorName",
    "donorFlat",
    "donatedOn",
  ])("refills %s", (name) => {
    expect(BOOK_FORM).toContain(`startsAs("${name}")`);
  });

  it("refills the do-not-publish tick as it was left", () => {
    // Not a permission being given -- the family already said it, and losing it
    // silently republishes a name they asked us to keep off the page.
    expect(BOOK_FORM).toContain("kept?.donorAnonymous ?? values?.donorAnonymous ?? false");
  });

  it("keeps the chosen picture attached", () => {
    /*
     * A file cannot travel back from the server, so the picker holds the
     * librarian's own File and puts it back. Without this the thumbnail would
     * still be on screen over an empty input, and the second save would store
     * no cover while looking exactly like the first.
     */
    expect(BOOK_FORM).toContain("const chosenFile = useRef<File | null>(null)");
    expect(BOOK_FORM).toContain("input.files = transfer.files");
  });

  it("refills every dropdown, not only the text boxes", () => {
    // React re-applies a changed defaultValue to an input but not to a select.
    for (const name of ["categoryId", "ageGroup", "condition", "status"]) {
      expect(BOOK_FORM).toContain(`selectKey("${name}")`);
    }
  });

  it("does not refill from the buttons that archive or delete a book", () => {
    // Those forms have nothing to refill; passing them would read as though
    // they did.
    expect(BOOK_ACTION.match(/toErrorState\(error, formData\)/g)).toHaveLength(2);
  });
});

describe("the join form", () => {
  it("is handed back what was typed", () => {
    expect(JOIN_ACTION).toContain("function readSubmission(formData: FormData)");
    expect(JOIN_ACTION).toMatch(/values\?:\s*RegistrationSubmission/);
  });

  it.each([
    "childName",
    "childBirthYear",
    "apartment",
    "guardianName",
    "guardianEmail",
    "guardianPhone",
  ])("refills %s", (name) => {
    expect(JOIN_FORM).toContain(`defaultValue={kept?.${name}`);
  });

  it("hands back every refusal, not only the invalid-answer one", () => {
    // A photo that could not be stored and a service refusal are both reasons a
    // parent is looking at this form again.
    const handed = JOIN_ACTION.match(/values: readSubmission\(formData\)|values,\n/g) ?? [];
    expect(handed.length).toBeGreaterThanOrEqual(5);
  });

  it("never restores a consent tick", () => {
    /*
     * The deliberate exception. Every other field is a fact being restated; a
     * tick is a permission being given, and it is worth the two seconds of
     * giving it again with the wording in front of you. A consent box that
     * arrives pre-ticked after a failure is a box nobody read twice.
     */
    expect(JOIN_ACTION).not.toContain("consentTypes: readSubmission");
    expect(JOIN_FORM).not.toMatch(/defaultChecked=\{[^}]*consent/i);
    expect(JOIN_FORM).not.toMatch(/name=\{`consent\.\$\{type\}`\}[\s\S]{0,200}defaultChecked/);
  });

  it("keeps the chosen photo attached", () => {
    const picker = read("src", "components", "library", "photo-picker.tsx");
    expect(picker).toContain("const chosenFile = useRef<File | null>(null)");
    expect(picker).toContain("input.files = transfer.files");
  });

  it("refills the birth year, which is a dropdown", () => {
    expect(JOIN_FORM).toContain("key={`childBirthYear-${keyFor(kept?.childBirthYear)}`}");
  });

  it("never restores the honeypot", () => {
    // A bot's own answer handed back to it is a hint it does not need.
    expect(JOIN_ACTION).not.toMatch(/website:\s*text\("website"\)/);
  });
});
