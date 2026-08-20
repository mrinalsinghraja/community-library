import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The activation fallback, checked at the source.
 *
 * The panel is a client component wired to a server action, so rendering it in
 * a unit test would need a session and a database and would still prove the
 * least interesting half. What matters here is a set of properties a later edit
 * removes by accident:
 *
 *   * one component, shared, so the words an administrator reads about a
 *     stalled activation do not depend on which list they opened;
 *   * the link is minted when the button is pressed — no page holds a live
 *     token before anybody asks for one;
 *   * neither screen contains a password field, because nobody sets anybody
 *     else's password;
 *   * the reader panel is behind `registration.review`, the Super-Admin-only
 *     permission, and the service checks it again regardless.
 *
 * The browser walkthrough covers what these look like. This covers what they
 * must never quietly become.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

const flattened = (source: string) => source.replace(/\s+/g, " ");

/** The file with its comments taken out — these files explain themselves. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const FALLBACK = read("components", "library", "activation-fallback.tsx");
const MEMBER_ACTIONS = read("app", "desk", "members", "member-actions.tsx");
const MEMBERS_PAGE = read("app", "desk", "members", "page.tsx");
const MEMBER_DETAIL = read("app", "desk", "members", "[id]", "page.tsx");
const STAFF_FORMS = read("app", "admin", "staff", "staff-forms.tsx");
// `server-only` and full of Prisma, so this suite reads the source rather than
// importing it.
const ACCOUNT_SERVICE = read("server", "services", "account-service.ts");
const STAFF_SERVICE = read("server", "services", "staff-service.ts");
const ACCOUNT_ACTIONS = read("server", "actions", "account-actions.ts");

describe("the panel says the same thing on both screens", () => {
  it("carries the wording the fallback exists for", () => {
    const rendered = flattened(code(FALLBACK));
    expect(rendered).toContain("Activation not sent");
    expect(rendered).toContain("The invitation email could not be sent.");
    expect(rendered).toContain("Copy activation link");
    expect(rendered).toContain("Activation link copied.");
  });

  it("is the only place that wording lives", () => {
    // Two copies would drift the first time one was edited.
    for (const source of [MEMBER_ACTIONS, STAFF_FORMS]) {
      expect(code(source)).not.toContain("Copy activation link");
      expect(code(source)).not.toContain("Activation link copied.");
    }
  });
});

describe("both screens wire it up", () => {
  it("the staff screen passes the staff action", () => {
    const rendered = flattened(code(STAFF_FORMS));
    expect(rendered).toContain("<ActivationFallback");
    expect(rendered).toContain('fieldName="staffId"');
    expect(rendered).toContain("action={issueStaffActivationLinkAction}");
    // Only while the account is waiting, and only while it is not paused.
    expect(rendered).toContain("{mustSetPassword && !isPaused ?");
  });

  it("the reader list passes the reader action", () => {
    const rendered = flattened(code(MEMBER_ACTIONS));
    expect(rendered).toContain("<ActivationFallback");
    expect(rendered).toContain('fieldName="memberId"');
    expect(rendered).toContain("action={issueMemberActivationLinkAction}");
    expect(rendered).toContain("mustSetPassword && !isPaused");
  });

  it("the reader detail page shows it too", () => {
    const rendered = flattened(code(MEMBER_DETAIL));
    expect(rendered).toContain("<ActivationFallback");
    expect(rendered).toContain('fieldName="memberId"');
    expect(rendered).toContain("action={issueMemberActivationLinkAction}");
  });

  it("keeps 'Send link again' beside it on both screens", () => {
    // The fallback is an addition. Email working is still the ordinary path.
    expect(code(STAFF_FORMS)).toContain("Send link again");
    expect(code(MEMBER_ACTIONS)).toContain("Send link again");
  });
});

describe("who the reader panel is rendered for", () => {
  it("the list asks for registration.review, not member.reset_password", () => {
    const rendered = flattened(code(MEMBERS_PAGE));
    expect(rendered).toContain('canIssueLink={actor.permissions.has("registration.review")}');
    // The reissue button keeps its own, softer permission — sending a link to
    // the address on file is a different act from handing over the raw URL.
    expect(rendered).toContain('canReissue={actor.permissions.has("member.reset_password")}');
  });

  it("the detail page asks for the same permission", () => {
    const rendered = flattened(code(MEMBER_DETAIL));
    expect(rendered).toContain('actor.permissions.has("registration.review")');
  });
});

describe("the service is what refuses", () => {
  it("gates the reader link on the Super-Admin-only permission", () => {
    expect(flattened(code(ACCOUNT_SERVICE))).toContain(
      'export async function issueMemberActivationLink( memberUserId: string, ): Promise<{ url: string; expiresAt: Date; displayName: string }> { const actor = await requirePermission("registration.review");',
    );
  });

  it("gates the staff link on user.manage_staff, as it always did", () => {
    expect(flattened(code(STAFF_SERVICE))).toContain(
      'export async function issueStaffActivationLink( staffUserId: string, ): Promise<{ url: string; expiresAt: Date; displayName: string }> { const actor = await requirePermission("user.manage_staff");',
    );
  });

  it("refuses an account that has already chosen a password", () => {
    expect(flattened(code(ACCOUNT_SERVICE))).toContain("if (!member.mustSetPassword) {");
    expect(flattened(code(STAFF_SERVICE))).toContain("if (!staff.mustSetPassword) {");
  });

  it("uses the existing token mint, not a new one", () => {
    const rendered = flattened(code(ACCOUNT_SERVICE));
    expect(rendered).toContain('type: "ACTIVATION",');
    expect(rendered).toContain("mintToken(tx, {");
  });

  it("writes no token and no URL into the audit row", () => {
    const rendered = flattened(code(ACCOUNT_SERVICE));
    expect(rendered).toContain(
      'metadata: { kind: "MEMBER", delivery: "manual", expiresAt: minted.expiresAt.toISOString() }',
    );
    expect(rendered).not.toContain("metadata: { token");
    expect(rendered).not.toContain("rawToken }");
  });
});

describe("no screen sets somebody else's password", () => {
  for (const [name, source] of [
    ["the shared panel", FALLBACK],
    ["the reader list actions", MEMBER_ACTIONS],
    ["the staff screen", STAFF_FORMS],
  ] as const) {
    it(`${name} has no password input`, () => {
      expect(code(source)).not.toMatch(/type=["']password["']/);
      expect(code(source)).not.toMatch(/name=["']password["']/);
    });
  }
});

describe("nothing holds a token before the button is pressed", () => {
  it("reads the URL only out of a successful action result", () => {
    const rendered = flattened(code(FALLBACK));
    expect(rendered).toContain(
      'const url = state.status === "success" ? state.activationUrl : undefined;',
    );
  });

  it("never revalidates the link back into a page", () => {
    // `revalidatePath` after minting would push the response — and the URL it
    // carries — through the router cache. The staff action has never done it
    // and the reader one must not either.
    const action = flattened(code(ACCOUNT_ACTIONS));
    const start = action.indexOf("export async function issueMemberActivationLinkAction");
    const end = action.indexOf("export async function", start + 10);
    expect(action.slice(start, end)).not.toContain("revalidatePath");
  });
});
