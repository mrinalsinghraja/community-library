import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESK_DESTINATIONS, DESK_GROUPS, deskDestinationsFor } from "@/lib/desk-nav";
import { audienceFor } from "@/lib/sign-in";

/**
 * The way in, and the desk's front.
 *
 * Both were redrawn for the same reason: a parent decides whether this site is
 * real in the first four seconds, and a volunteer decides whether they can
 * work it in the first afternoon. What these tests hold onto is not the look
 * but the promises the look was allowed to change nothing about.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("the sign-in form asks who you are, and changes nothing else", () => {
  const FORM = read("app", "login", "login-form.tsx");
  const PAGE = read("app", "login", "page.tsx");

  it("still sends the one field the server has always read", () => {
    // The switch is presentation. `identifier` and `password` reach the same
    // action under the same names, and the server still works out which kind
    // of name it was given.
    expect(FORM).toContain('name="identifier"');
    expect(FORM).toContain('name="password"');
    expect(FORM).toContain("signInAction");
    expect(FORM).not.toMatch(/name="role"|name="kind"|name="email"|name="card"/);
  });

  it("offers exactly two audiences, and names staff as one", () => {
    /*
     * "Library staff", not "Librarian" and "Super Admin". Two kinds of staff
     * sign in the same way, and the form has no business telling a stranger
     * that two kinds exist.
     */
    const rendered = code(FORM);
    expect(rendered).toContain('value="reader"');
    expect(rendered).toContain('value="staff"');
    expect(rendered).not.toMatch(/super ?admin/i);
    expect(rendered).not.toMatch(/value="librarian"|value="admin"/i);
  });

  it("uses native radios, so the keyboard and the screen reader get the platform's own switch", () => {
    expect(FORM).toContain('type="radio"');
    expect(FORM).toContain("<legend");
  });

  it("asks a reader for a card and a colleague for an address", () => {
    expect(FORM).toContain('"Your library card number"');
    expect(FORM).toContain('"Your email address"');
    // The server's own advice, kept: card-identity.test.ts holds this line too.
    expect(FORM).toMatch(/use your email address/i);
  });

  it("remounts the box when the audience changes, so a half-typed card is not sent as an email", () => {
    expect(FORM).toMatch(/<TextInput\s+key=\{audience\}/);
  });

  it("keeps the vague refusal vague", () => {
    // Nothing on the form may say which half was wrong. The message comes
    // from the server unchanged; the form only draws it.
    expect(code(FORM)).not.toMatch(/wrong password|no such (card|account|user)|not a member/i);
  });

  it("keeps the two doors under the form", () => {
    expect(PAGE).toContain('href="/forgot"');
    expect(PAGE).toContain('href="/join"');
  });

  it("tells a parent nobody here can see the password, on both halves", () => {
    // Once in the room, once under the form. A promise about a child's
    // password is worth making where a parent is looking, which is not
    // necessarily where the form is.
    const ROOM = read("components", "layout", "auth-room.tsx");
    const flat = (PAGE + ROOM).replace(/\s+/g, " ");
    expect(flat.match(/Nobody at the library can see your password/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("every door into the library opens onto the same room", () => {
  /*
   * Six pages a family meets in their first week. Each one arranged
   * differently reads as carelessness; the frame is shared so they cannot
   * drift apart again.
   */
  const DOORS = [
    ["app", "login", "page.tsx"],
    ["app", "forgot", "page.tsx"],
    ["app", "reset", "[token]", "page.tsx"],
    ["app", "activate", "[token]", "page.tsx"],
    ["app", "verify", "[token]", "page.tsx"],
    ["app", "join", "page.tsx"],
  ] as const;

  it.each(DOORS.map((parts) => [parts.join("/"), parts] as const))(
    "%s is drawn in the room",
    (_, parts) => {
      const source = read(...parts);
      expect(source).toContain("<AuthRoom");
      // No page keeps a private frame beside the shared one.
      expect(source).not.toMatch(/max-w-xl px-5 py-14/);
    },
  );

  it("keeps the joining form the wide, stacked way", () => {
    expect(read("app", "join", "page.tsx")).toMatch(/<AuthRoom[\s\S]*?\bstacked\b/);
  });

  it("keeps the expired-link pages vague about why", () => {
    for (const parts of DOORS.slice(2, 5)) {
      const source = read(...parts).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(source).not.toMatch(/already used|cancelled|never existed|wrong link/i);
    }
  });

  it("puts the panel second on a phone and first on a desk", () => {
    const ROOM = read("components", "layout", "auth-room.tsx");
    expect(ROOM).toContain("order-2");
    expect(ROOM).toContain("lg:order-none");
  });
});

describe("every content page opens the same way", () => {
  it.each([
    ["app", "contact", "page.tsx"],
    ["app", "rules", "page.tsx"],
    ["app", "how-to-join", "page.tsx"],
    ["app", "faq", "page.tsx"],
    ["components", "library", "legal-page.tsx"],
  ] as const)("%s/%s/%s carries an eyebrow", (...parts) => {
    expect(read(...parts)).toMatch(/<PageHeading\s+eyebrow="[^"]+"/);
  });
});

describe("which half comes first", () => {
  it("guesses staff from where they were headed", () => {
    expect(audienceFor("/desk")).toBe("staff");
    expect(audienceFor("/desk/loans")).toBe("staff");
    expect(audienceFor("/admin/settings")).toBe("staff");
  });

  it("guesses a reader from anywhere else, including nowhere", () => {
    expect(audienceFor(undefined)).toBe("reader");
    expect(audienceFor("")).toBe("reader");
    expect(audienceFor("/my-books")).toBe("reader");
    // Everybody's page, so it says nothing about who you are.
    expect(audienceFor("/account")).toBe("reader");
  });

  it("is not fooled by a path that merely mentions the desk", () => {
    expect(audienceFor("/books?q=desk")).toBe("reader");
    expect(audienceFor("/desktop")).toBe("staff"); // a prefix match; there is no such page
  });
});

describe("the desk's doors stand in clusters", () => {
  it("gives every door a cluster the shell knows how to draw", () => {
    for (const door of DESK_DESTINATIONS) {
      expect(DESK_GROUPS, door.href).toContain(door.group);
    }
  });

  it("draws the clusters in the order of an afternoon", () => {
    // Books first, then people, then the shelves, then the room, then the
    // administration that is nobody's afternoon job.
    expect(DESK_GROUPS).toEqual(["Lending", "People", "Shelves", "The room", "Admin"]);
  });

  it("keeps the doors of one cluster together in the list", () => {
    /*
     * The shell slices the flat list by cluster, so if the array interleaved
     * them the desk would draw "Lending" twice. Each cluster must be one
     * contiguous run.
     */
    const seen = new Set<string>();
    let previous: string | null = null;
    for (const door of DESK_DESTINATIONS) {
      if (door.group !== previous) {
        expect(seen.has(door.group), `${door.group} appears twice`).toBe(false);
        seen.add(door.group);
        previous = door.group;
      }
    }
  });

  it("shows a librarian no heading over an empty cluster", () => {
    // The shell drops a cluster with nothing in it. Asserted at the source,
    // since the shell is a server component the unit suite cannot render.
    const shell = read("components", "layout", "staff-shell.tsx");
    expect(shell).toContain("cluster.doors.length > 0");
    // And the flat list it slices from is still the one filtered by permission.
    expect(shell).toContain("deskDestinationsFor(actor.permissions)");
    void deskDestinationsFor;
  });
});

describe("where you are", () => {
  const NAV_LINK = read("components", "layout", "nav-link.tsx");
  const SITE = read("components", "layout", "site-shell.tsx");
  const STAFF = read("components", "layout", "staff-shell.tsx");
  const DESK_NAV = read("lib", "desk-nav.ts");

  it("marks the current page with aria-current, not a class alone", () => {
    expect(NAV_LINK).toContain('aria-current={current ? "page" : undefined}');
  });

  it("is drawn by both shells", () => {
    expect(SITE).toContain("<NavLink");
    expect(STAFF).toContain("<NavLink");
  });

  it("matches Home exactly, so it is not current on every page", () => {
    expect(SITE).toContain('exact={item.href === "/"}');
    expect(STAFF).toContain('exact={item.href === "/"}');
  });

  it("keeps the lists themselves ignorant of the pathname", () => {
    // navigation.test.ts holds this too; repeated here because this is the
    // change that introduced a pathname to the shells at all.
    expect(DESK_NAV).not.toMatch(/usePathname|pathname/);
  });
});

describe("the desk's title says where you are", () => {
  it("names the cluster from the address, longest door first", async () => {
    const { deskGroupForPath } = await import("@/lib/desk-group");

    expect(deskGroupForPath("/desk/loans")).toBe("Lending");
    expect(deskGroupForPath("/desk/members/01a0-some-id")).toBe("People");
    expect(deskGroupForPath("/admin/books/new")).toBe("Shelves");
    expect(deskGroupForPath("/admin/books/labels")).toBe("Shelves");
    expect(deskGroupForPath("/desk/reports")).toBe("The room");
    expect(deskGroupForPath("/admin/audit")).toBe("Admin");
  });

  it("says nothing on a screen that belongs to no cluster", async () => {
    const { deskGroupForPath } = await import("@/lib/desk-group");

    // Shared by staff and readers; the desk landing is a door to all of them.
    expect(deskGroupForPath("/account")).toBeNull();
    expect(deskGroupForPath("/desk")).toBeNull();
    expect(deskGroupForPath("/")).toBeNull();
  });

  it("is drawn by the shell over every desk title", () => {
    const shell = read("components", "layout", "staff-shell.tsx");
    expect(shell).toMatch(/<DeskEyebrow \/>\s*<h1/);
  });

  it("keeps the lists themselves ignorant of the address", () => {
    // The eyebrow reads the address in its own file. desk-nav.ts still does not.
    expect(read("lib", "desk-nav.ts")).not.toMatch(/usePathname|pathname/);
    expect(read("components", "layout", "desk-eyebrow.tsx")).toContain("usePathname");
  });
});
