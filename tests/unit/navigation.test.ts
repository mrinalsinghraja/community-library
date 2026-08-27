import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DESK_DESTINATIONS,
  READER_DESTINATIONS,
  canReachDesk,
  deskDestinationsFor,
  readerDestinationsFor,
} from "@/lib/desk-nav";
import { ROLE_DEFINITIONS, ROLE_KEYS, type PermissionKey } from "@/lib/permissions";

/**
 * One menu per role, on every screen.
 *
 * This application has two shells — the reader app and the desk — and each used
 * to own a navigation array. That is how a Super Admin came to see the
 * children's masthead on `/account` and a completely different desk menu on
 * `/desk/loans`, with an item on the reader side ("My books") that silently
 * redirected them somewhere else because staff hold no library card.
 *
 * These tests hold the fix in place. Two of them read the shell source directly,
 * which is the only way to assert "this component does not build its own list"
 * without rendering a server component.
 */

const permissionsOf = (role: string): ReadonlySet<PermissionKey> => {
  const definition = ROLE_DEFINITIONS.find((entry) => entry.key === role);
  if (!definition) throw new Error(`No role ${role}`);
  return new Set(definition.permissions);
};

const READER_SHELL = readFileSync(
  join(process.cwd(), "src", "components", "layout", "site-shell.tsx"),
  "utf8",
);
const STAFF_SHELL = readFileSync(
  join(process.cwd(), "src", "components", "layout", "staff-shell.tsx"),
  "utf8",
);

describe("one source of truth", () => {
  it("gives neither shell a destination list of its own", () => {
    // The bug was structural: two arrays, edited independently, drifting.
    for (const source of [READER_SHELL, STAFF_SHELL]) {
      expect(source).not.toMatch(/const\s+DESTINATIONS\s*[:=]/);
      expect(source).not.toMatch(/const\s+NAV_ITEMS\s*[:=]/);
    }
  });

  it("has both shells read the same two functions", () => {
    for (const source of [READER_SHELL, STAFF_SHELL]) {
      expect(source).toContain("readerDestinationsFor");
    }
    expect(STAFF_SHELL).toContain("deskDestinationsFor");
    expect(READER_SHELL).toContain("canReachDesk");
  });

  it("never labels two destinations the same thing", () => {
    /*
     * "Books" used to be the reader's catalogue AND the desk's book list, so a
     * librarian saw one word in two menus pointing at two different pages.
     */
    const labels = [
      ...DESK_DESTINATIONS.map((item) => item.label),
      ...READER_DESTINATIONS.map((item) => item.label),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("points every destination at a distinct page", () => {
    const hrefs = [
      ...DESK_DESTINATIONS.map((item) => item.href),
      ...READER_DESTINATIONS.map((item) => item.href),
    ];
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("what each role is offered", () => {
  it("never offers a reader's own pages to staff", () => {
    /*
     * The defect this replaced: `/my-books` and `/my-reviews` read the session,
     * find no member, and redirect a librarian to the desk. A door that
     * teleports you elsewhere is worse than no door.
     */
    const staff = readerDestinationsFor({
      isMember: false,
      signedIn: true,
      cataloguePublic: true,
    });

    expect(staff.map((item) => item.href)).not.toContain("/my-books");
    expect(staff.map((item) => item.href)).not.toContain("/my-reviews");
  });

  it("offers them to a reader", () => {
    const member = readerDestinationsFor({
      isMember: true,
      signedIn: true,
      cataloguePublic: true,
    });

    expect(member.map((item) => item.href)).toContain("/my-books");
    expect(member.map((item) => item.href)).toContain("/my-reviews");
  });

  it("hides the catalogue from a stranger when the shelf is not public", () => {
    const visitor = (cataloguePublic: boolean) =>
      readerDestinationsFor({ isMember: false, signedIn: false, cataloguePublic }).map(
        (item) => item.href,
      );

    expect(visitor(true)).toContain("/books");
    expect(visitor(false)).not.toContain("/books");
  });

  it("always offers the pages anybody may read, starting at home", () => {
    for (const isMember of [true, false]) {
      for (const signedIn of [true, false]) {
        const hrefs = readerDestinationsFor({
          isMember,
          signedIn,
          cataloguePublic: false,
        }).map((item) => item.href);

        expect(hrefs).toContain("/how-to-join");
        expect(hrefs).toContain("/rules");
        expect(hrefs).toContain("/donors");
        expect(hrefs).toContain("/faq");
        // Home is offered to every role in every state, and is offered first.
        expect(hrefs[0]).toBe("/");
      }
    }
  });

  it("gives a reader no desk doors at all", () => {
    const member = permissionsOf(ROLE_KEYS.MEMBER);

    expect(deskDestinationsFor(member)).toHaveLength(0);
    expect(canReachDesk(member)).toBe(false);
  });

  it("gives a librarian the desk without the administrative screens", () => {
    const hrefs = deskDestinationsFor(permissionsOf(ROLE_KEYS.LIBRARIAN)).map(
      (item) => item.href,
    );

    expect(hrefs).toContain("/desk/circulation");
    expect(hrefs).toContain("/desk/reviews");
    // Configuration and the audit log are the owner's.
    expect(hrefs).not.toContain("/admin/settings");
    expect(hrefs).not.toContain("/admin/audit");
    expect(hrefs).not.toContain("/admin/staff");
  });

  it("gives the Super Admin every desk door", () => {
    const hrefs = deskDestinationsFor(permissionsOf(ROLE_KEYS.SUPER_ADMIN)).map(
      (item) => item.href,
    );

    expect(hrefs).toEqual(DESK_DESTINATIONS.map((item) => item.href));
  });
});

describe("the menu does not depend on the page", () => {
  /*
   * The property the owner asked for, stated directly: for one role, the answer
   * is a pure function of who they are. Neither of these functions takes a
   * route, a pathname or a shell, so there is nowhere for a per-page difference
   * to come from — and this test fails the moment somebody adds one.
   */
  it("takes no argument describing where the person is standing", () => {
    expect(readerDestinationsFor.length).toBe(1);
    expect(deskDestinationsFor.length).toBe(1);

    const source = readFileSync(join(process.cwd(), "src", "lib", "desk-nav.ts"), "utf8");
    expect(source).not.toMatch(/pathname|usePathname|currentPath|route\b/);
  });

  it("returns the same list for the same role every time it is asked", () => {
    const ask = () =>
      [
        ...deskDestinationsFor(permissionsOf(ROLE_KEYS.LIBRARIAN)).map((i) => i.label),
        ...readerDestinationsFor({
          isMember: false,
          signedIn: true,
          cataloguePublic: true,
        }).map((i) => i.label),
      ].join("|");

    expect(ask()).toBe(ask());
  });
});
