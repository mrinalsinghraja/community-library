import { readdirSync, readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------

describe("the masthead says the same thing on every page", () => {
  const SHELL = read("components", "layout", "site-shell.tsx");
  const STAFF = read("components", "layout", "staff-shell.tsx");
  const DESK_NAV = read("lib", "desk-nav.ts");

  it("asks the session, and takes no flag a page could forget", () => {
    /*
     * The bug this closes. "Sign in" versus "My library" came from a `signedIn`
     * prop while the desk link was read from `getActor()`, so the two halves
     * disagreed: seven pages had omitted the prop, and on those a signed-in
     * administrator was shown "Sign in" AND a link to the library desk at the
     * same time, with Books and My books hidden from somebody holding a valid
     * session.
     *
     * A flag every page must remember is a flag some page will forget. The
     * shell now derives it, and there is no prop left to omit.
     */
    expect(SHELL).toContain("const signedIn = Boolean(actor)");
    // The header takes branding and nothing else -- there is no flag left to omit.
    expect(SHELL).toContain("export async function SiteHeader({ branding }: { branding: Branding })");
    // The shell itself no longer accepts one either.
    expect(SHELL).not.toMatch(/branding: Branding;\s*signedIn\?: boolean;\s*children: ReactNode/);
  });

  it("leaves no page able to pass one", () => {
    const pages = readdirSync(join(process.cwd(), "src", "app"), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith("page.tsx"));

    for (const page of pages) {
      const source = readFileSync(join(process.cwd(), "src", "app", page), "utf8");
      expect(source, page).not.toMatch(/<PublicShell[^>]*signedIn/);
    }
  });

  it("opens the desk for anybody who works there, not only the Super Admin", () => {
    /*
     * It asked for `user.manage_staff`, which only the Super Admin holds — so a
     * Librarian opening their own account page landed somewhere with no route
     * back to the library they run.
     */
    expect(SHELL).toContain("canReachDesk(actor.permissions)");
    expect(SHELL).not.toContain('permissions.has("user.manage_staff")');
  });

  it("sends them to the desk itself, not to one page on it", () => {
    // /admin/staff is a door a Librarian may not open.
    expect(SHELL).toContain('href="/desk"');
    expect(SHELL).not.toContain('href="/admin/staff"');
  });

  it("keeps one list of desk doors, so the two shells cannot disagree", () => {
    expect(STAFF).toContain("deskDestinationsFor(actor.permissions)");
    expect(DESK_NAV).toContain("export const DESK_DESTINATIONS");
    // The staff shell no longer keeps a second copy.
    expect(STAFF).not.toContain('label: "Issue", permission');
  });

  it("still hides every desk door from a reader", () => {
    // canReachDesk is a filter over permissions, so a reader holding none of
    // them gets an empty list and no link.
    expect(DESK_NAV).toContain("deskDestinationsFor(permissions).length > 0");
  });
});
