import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The people-management screens, checked at the source.
 *
 * These are server components and client components wired to server actions, so
 * rendering them in a unit test would need a database, a session and a router —
 * and would still prove the least interesting half. What matters here is a
 * property of how they are written, and it is the kind of property a later edit
 * removes by accident:
 *
 *   * the approve and reject controls must be behind `canReview`, and a
 *     librarian must be told who decides instead;
 *   * no screen anywhere may contain a password input for somebody else's
 *     account;
 *   * every destructive control must say "Delete permanently", and must be
 *     behind a permission flag.
 *
 * The browser walkthrough covers what these look like. This covers what they
 * must never quietly become.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

/** Prose wraps across lines in JSX; a sentence is easier to look for unwrapped. */
const flattened = (source: string) => source.replace(/\s+/g, " ");

/** The file with its comments taken out — these files explain themselves. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const REVIEW_ACTIONS = read("app", "desk", "registrations", "review-actions.tsx");
const REGISTRATIONS_PAGE = read("app", "desk", "registrations", "page.tsx");
const MEMBER_DETAIL = read("app", "desk", "members", "[id]", "page.tsx");
const MEMBER_DELETE = read("app", "desk", "members", "[id]", "delete-account.tsx");
const STAFF_FORMS = read("app", "admin", "staff", "staff-forms.tsx");
const STAFF_PAGE = read("app", "admin", "staff", "page.tsx");
// The services are `server-only` and pull in Prisma, so this suite reads them
// rather than importing them.
const ACCOUNT_SERVICE = read("server", "services", "account-service.ts");
const STAFF_SERVICE = read("server", "services", "staff-service.ts");

describe("approving a registration is the Super Admin's", () => {
  it("puts the approve and reject controls behind canReview", () => {
    expect(code(REVIEW_ACTIONS)).toContain("canReview");
    expect(code(REGISTRATIONS_PAGE)).toContain('actor.permissions.has("registration.review")');
  });

  it("tells a librarian who decides instead", () => {
    const rendered = flattened(code(REVIEW_ACTIONS));
    expect(rendered).toContain("Waiting for Super Admin approval.");
    expect(rendered).toContain(
      "You can review the details, but only the Super Admin can approve or reject a new member.",
    );
  });

  it("still lets a librarian read the whole submission", () => {
    // The details are rendered by the page, outside ReviewActions, so hiding
    // the decision cannot hide the family.
    for (const field of [
      "request.guardianName",
      "request.guardianEmail",
      "request.guardianPhone",
      "request.apartment",
      "request.submittedAt",
      "request.photoMediaId",
      "request.avatarKey",
    ]) {
      expect(REGISTRATIONS_PAGE, `the queue must show ${field}`).toContain(field);
    }
  });

  it("shows consent one line at a time, and the photo consent only with a photo", () => {
    expect(code(REGISTRATIONS_PAGE)).toContain("CONSENT_LABELS");
    expect(flattened(code(REGISTRATIONS_PAGE))).toContain(
      'type !== "CHILD_PHOTO_STORAGE" || request.photoMediaId',
    );
  });
});

describe("no screen sets somebody else's password", () => {
  for (const [name, source] of [
    ["the registration queue", REGISTRATIONS_PAGE],
    ["the reader detail page", MEMBER_DETAIL],
    ["the reader delete form", MEMBER_DELETE],
    ["the staff screen", STAFF_FORMS],
    ["the staff page", STAFF_PAGE],
  ] as const) {
    it(`${name} has no password input`, () => {
      expect(code(source)).not.toMatch(/type=["']password["']/);
      expect(code(source)).not.toMatch(/name=["']password["']/);
    });
  }
});

describe("deletion says what it is", () => {
  it("is labelled Delete permanently everywhere it appears", () => {
    for (const [name, source] of [
      ["the reader delete form", MEMBER_DELETE],
      ["the staff row", STAFF_FORMS],
      ["the reader detail page", MEMBER_DETAIL],
    ] as const) {
      expect(flattened(code(source)), `${name} must name the action`).toContain(
        "Delete permanently",
      );
    }
  });

  it("asks twice, and asks for the name", () => {
    for (const source of [MEMBER_DELETE, STAFF_FORMS]) {
      expect(code(source)).toContain("nameMatches");
      expect(code(source)).toContain("to confirm");
    }
  });

  it("is behind a permission flag on both screens", () => {
    expect(code(MEMBER_DETAIL)).toContain('actor.permissions.has("user.delete")');
    expect(code(STAFF_PAGE)).toContain('actor.permissions.has("user.delete")');
    expect(code(STAFF_FORMS)).toContain("canDelete");
  });

  it("uses one refusal message, and it names the alternative", () => {
    expect(flattened(ACCOUNT_SERVICE)).toContain(
      "This account has library history and cannot be permanently deleted. Deactivate/archive it instead.",
    );
    // Both services answer with the same sentence, from the same constant —
    // there is no second wording to drift.
    expect(code(STAFF_SERVICE)).toContain("DELETE_REFUSED_MESSAGE");
    expect(code(ACCOUNT_SERVICE)).toContain("DELETE_REFUSED_MESSAGE");
  });

  it("is guarded by user.delete in both services, not by a role name", () => {
    expect(code(ACCOUNT_SERVICE)).toContain('requirePermission("user.delete")');
    expect(code(STAFF_SERVICE)).toContain('requirePermission("user.delete")');
    for (const source of [ACCOUNT_SERVICE, STAFF_SERVICE]) {
      expect(code(source)).not.toMatch(/role\s*===\s*["']SUPER_ADMIN["']/);
    }
  });
});

describe("the staff table", () => {
  it("shows the columns the brief asks for, in order", () => {
    expect(flattened(code(STAFF_PAGE))).toContain(
      '["Name", "Email", "Role", "Status", "Added", "Actions"]',
    );
  });

  it("has no role dropdown", () => {
    expect(code(STAFF_FORMS)).not.toMatch(/<select/i);
    expect(code(STAFF_FORMS)).not.toContain("roleKey");
  });

  it("keeps the activation fallback that email failure needs", () => {
    const rendered = flattened(code(STAFF_FORMS));
    // The panel itself now lives in one shared component, so both the staff and
    // the reader screens read the same words — see activation-fallback-ui. What
    // the staff screen still owns is the wiring, and losing that would take the
    // fallback away just as surely as deleting the words would.
    expect(rendered).toContain("<ActivationFallback");
    expect(rendered).toContain('fieldName="staffId"');
    expect(rendered).toContain("action={issueStaffActivationLinkAction}");
    expect(rendered).toContain("Send link again");
  });
});
