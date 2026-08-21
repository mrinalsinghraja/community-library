import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { roleDescription, roleLabel } from "@/lib/permissions";

/**
 * Everybody's own account page.
 *
 * The behaviour underneath — who the recovery email reaches, that a note goes
 * out on every password change — is proved against a real database in
 * `tests/database/activation-and-reset.test.ts`. What is held here is that the
 * page a person actually opens offers the doors, because a capability nobody
 * can find is not a capability:
 *
 *   * a librarian standing on a desk screen could reach their own account only
 *     by typing the URL, since every desk page renders the staff shell and the
 *     staff shell had no link to it;
 *   * somebody who has forgotten their password met a form demanding the
 *     current one, with the emailed-link route reachable only by signing out;
 *   * and the page told a volunteer they were a `SUPER_ADMIN`.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

const ACCOUNT = read("app", "account", "page.tsx");
const PASSWORD_PAGE = read("app", "account", "password", "page.tsx");
const STAFF_SHELL = read("components", "layout", "staff-shell.tsx");
const LOGIN = read("app", "login", "page.tsx");

const flattened = (source: string) => source.replace(/\s+/g, " ");

describe("finding your own account", () => {
  it("is reachable from the desk, not only by typing the URL", () => {
    expect(STAFF_SHELL).toContain('href="/account"');
  });

  it("is reachable from the reader masthead", () => {
    const shell = read("components", "layout", "site-shell.tsx");
    expect(shell).toContain('href={signedIn ? "/account" : "/login"}');
  });

  it("offers the emailed reset from the login page, for somebody not signed in", () => {
    expect(LOGIN).toContain('href="/forgot"');
  });
});

describe("what the account page says", () => {
  it("names roles the way a person would say them", () => {
    // `SUPER_ADMIN` is a database key being shouted at a volunteer.
    expect(ACCOUNT).toContain("roleLabel(role)");
    expect(ACCOUNT).not.toMatch(/\{role\}\s*<\/StatusBadge>/);
  });

  it("says what each role is for", () => {
    expect(ACCOUNT).toContain("roleDescription(role)");
  });

  it("says where a reset link would actually land", () => {
    /*
     * The fact a reader cannot otherwise discover: recovery reaches their
     * parent, not them. Without it they wait for an email that arrived in
     * somebody else's inbox.
     */
    expect(ACCOUNT).toContain("account.recoveryEmail");
    expect(ACCOUNT).toContain("account.recoveryIsGuardian");
  });

  it("offers both routes to a new password", () => {
    expect(ACCOUNT).toContain('href="/account/password"');
    expect(ACCOUNT).toContain('href="/forgot"');
  });

  it("promises the note that goes out when it changes", () => {
    expect(flattened(ACCOUNT)).toMatch(/we send a note to that address/i);
  });

  it("never renders a password, a hash or a token", () => {
    // The summary service returns none of these; this is the second lock.
    expect(ACCOUNT).not.toMatch(/passwordHash|rawToken|\.token\b/);
  });
});

describe("the change-password form", () => {
  it("still demands the current one", () => {
    // What stops a borrowed unlocked device becoming a stolen account.
    const form = read("app", "account", "password", "change-password-form.tsx");
    expect(form).toContain('name="currentPassword"');
  });

  it("offers a way out for somebody who cannot remember it", () => {
    // Otherwise the only remedy is to sign out and find the link on /login,
    // which is a strange thing to ask of somebody already signed in.
    expect(PASSWORD_PAGE).toContain('href="/forgot"');
  });
});

describe("role labels", () => {
  it("turns a key into a name", () => {
    expect(roleLabel("SUPER_ADMIN")).toBe("Super Admin");
    expect(roleLabel("LIBRARIAN")).toBe("Librarian");
  });

  it("falls back to the key rather than throwing", () => {
    // An unknown role is a reason to show something plain, never a reason for
    // somebody's own page to fail.
    expect(roleLabel("NOT_A_ROLE")).toBe("NOT_A_ROLE");
    expect(roleDescription("NOT_A_ROLE")).toBeNull();
  });

  it("describes every role it names", () => {
    for (const key of ["SUPER_ADMIN", "LIBRARIAN", "MEMBER", "GUARDIAN"]) {
      expect(roleDescription(key)).toBeTruthy();
    }
  });
});
