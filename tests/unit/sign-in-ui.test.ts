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

describe("every reader page opens the same way", () => {
  /*
   * The reader's own pages were the last set drawing their headings by hand:
   * four sizes of `h1` between them, three hand-placed butterflies, four
   * hand-rolled page frames, and no page saying which part of the library it
   * belonged to. They open like the content pages and the desk now — the
   * section in small capitals, then the heading on its rule.
   */
  const READER_PAGES = [
    ["app", "books", "page.tsx"],
    ["app", "donors", "page.tsx"],
    ["app", "donors", "[donor]", "page.tsx"],
    ["app", "my-books", "page.tsx"],
    ["app", "my-card", "page.tsx"],
    ["app", "my-reviews", "page.tsx"],
    ["app", "account", "details", "page.tsx"],
    ["app", "account", "password", "page.tsx"],
  ] as const;

  it.each(READER_PAGES.map((parts) => [parts.join("/"), parts] as const))(
    "%s carries an eyebrow",
    (_, parts) => {
      expect(read(...parts)).toMatch(/<PageHeading[\s\S]{0,80}eyebrow=/);
    },
  );

  it.each(READER_PAGES.map((parts) => [parts.join("/"), parts] as const))(
    "%s draws no heading of its own beside it",
    (_, parts) => {
      // A hand-rolled <h1> beside a PageHeading is two headings on one page.
      expect(read(...parts)).not.toMatch(/<h1\s/);
    },
  );

  it("lets the page width come from the shell, not from each page", () => {
    for (const parts of [
      ["app", "books", "[code]", "page.tsx"],
      ["app", "donors", "[donor]", "page.tsx"],
      ["app", "my-card", "page.tsx"],
      ["app", "account", "password", "page.tsx"],
    ] as const) {
      const source = read(...parts);
      expect(source, parts.join("/")).toContain("<PageBody");
      expect(source, parts.join("/")).not.toMatch(/mx-auto w-full max-w-\w+ px-5 py-\d+/);
    }
  });

  it("names the shelf over a book, because that is where to walk", () => {
    // The one eyebrow on a reader page that is information rather than a label.
    expect(read("app", "books", "[code]", "page.tsx")).toMatch(
      /tracking-\[0\.18em\][\s\S]{0,120}book\.categoryName/,
    );
  });
});

describe("a page shared by staff and readers has one heading", () => {
  /*
   * `/account`, `/account/details`, `/account/password` and `/my-card` render
   * in whichever shell the person belongs to. They drew their own heading and
   * ALSO handed one to the desk shell, so a librarian on their own account page
   * met two `h1`s — "My library" above "Hello, Local Admin!".
   */
  const SHARED = [
    ["app", "account", "page.tsx"],
    ["app", "account", "details", "page.tsx"],
    ["app", "account", "password", "page.tsx"],
    ["app", "my-card", "page.tsx"],
  ] as const;

  it.each(SHARED.map((parts) => [parts.join("/"), parts] as const))(
    "%s hands the shell no title",
    (_, parts) => {
      expect(read(...parts)).not.toMatch(/<Shell[^>]*\stitle=/);
    },
  );

  it("lets the desk shell go without one", () => {
    const shell = read("components", "layout", "staff-shell.tsx");
    expect(shell).toContain("title?: string;");
    // And draws nothing at all rather than an empty header block.
    expect(shell).toMatch(/\{title \? \([\s\S]{0,600}?<header/);
  });
});

describe("a thumb can find every door", () => {
  /*
   * Measured on a 375px phone, and the answer was no: the doors in the
   * masthead were 39px tall, the desk's were 33, and every link in the footer
   * — including the four policy links — was 23. Every *button* in this system
   * is sized for a five-year-old's hand; the navigation had never been held to
   * the same rule, which is the part of a page a child actually uses most.
   *
   * 44px is the floor. The desk drops back to its own density from `sm` up,
   * because a librarian at a keyboard is not the person the floor is for and
   * the desk buys its density from exactly this kind of vertical space.
   *
   * Links inside a sentence are deliberately not covered: a 44px box around
   * three words of running prose would break the line it sits in, and the
   * target-size rule has always exempted them.
   */
  const SITE = read("components", "layout", "site-shell.tsx");
  const STAFF = read("components", "layout", "staff-shell.tsx");

  it("gives the reader's doors and footer links a 44px box", () => {
    expect(SITE).toMatch(/const NAV_LINK =\s*\n?\s*"inline-flex min-h-11 items-center/);
    expect(SITE).toContain('const FOOT_LINK = "inline-flex min-h-11 items-center no-underline"');
  });

  it("uses that box for every list of links at the foot of the page", () => {
    // Destinations, the way in, WhatsApp, the email address, the policy row.
    expect(SITE.match(/\$\{FOOT_LINK\}/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("stops relying on a gap to separate them", () => {
    // The hit areas touch now, so a gap on top of them would only add height.
    expect(SITE).not.toMatch(/<ul className="mt-4 flex flex-col gap-2\.5">/);
  });

  it("gives the desk a floor a finger can hit, and asks the pointer rather than the width", () => {
    /*
     * This started as `min-h-11 sm:min-h-0` — 44px on a phone, the desk's own
     * density from 640px up. That asked the wrong question. A tablet is 768px
     * wide and is operated entirely by thumb, so the desk was handing a
     * librarian 37px doors on exactly the device they are most likely to be
     * holding at the desk.
     */
    const CSS_ = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const floor = CSS_.slice(CSS_.indexOf(".tap-floor {"), CSS_.indexOf(".desk-plate {"));

    // The floor is the default and a FINE pointer is what removes it, so a
    // device that reports nothing useful still gets the accessible size.
    expect(floor).toMatch(/\.tap-floor \{\s*min-height: 2\.75rem/);
    expect(floor).toMatch(/@media \(pointer: fine\)[\s\S]*?min-height: 0/);

    // Every door, the reader band under it, the person's name, and the way out.
    expect(STAFF.match(/tap-floor/g)?.length).toBeGreaterThanOrEqual(4);
    // And nothing left guessing from the width.
    expect(STAFF).not.toContain("sm:min-h-0");
  });

  it("names the desk's clusters at every width, phone included", () => {
    // They were drawn from `lg` up, which is the screen that needed them least.
    const label = STAFF.slice(STAFF.indexOf("{cluster.group}") - 400, STAFF.indexOf("{cluster.group}"));
    expect(label).not.toMatch(/hidden[^"]*lg:block/);
  });
});

describe("one lit band opens every page", () => {
  /*
   * The library had two visual languages and no rule about which page got
   * which. The front door, the sign-in and the joining form were lit; every
   * page a family opened afterwards was ink on flat paper, so the site looked
   * like two sites — the one that persuaded them and the one they then had to
   * use.
   *
   * The band is the FRONT DOOR's light, not the sign-in room's. A room is a
   * moment at a door; a page is somewhere a person stands, and it should not be
   * a slab of night at the top of every screen a child opens. The dark room is
   * still the sign-in's alone.
   *
   * `PageHeading` is the band, so no page was edited to get it, and
   * `.theme-band` is the one place its colours are written down.
   */
  const CSS = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const HEADING = read("components", "layout", "site-shell.tsx");
  const STAFF = read("components", "layout", "staff-shell.tsx");
  const band = () => CSS.slice(CSS.indexOf(".theme-band {"), CSS.indexOf(".theme-band::before"));

  it("is lit by the two lights the home page is lit by", () => {
    // Gold high on the left, the deep primary low on the right.
    expect(band()).toContain("rgb(242 197 124");
    expect(band()).toContain("rgb(31 111 92");
  });

  it("stands on the page's own surface, not on a dark ground", () => {
    expect(band()).toContain("background-color: var(--color-surface)");
    expect(band()).not.toContain("--color-primary-night");
  });

  it("keeps the dark room for the sign-in alone", () => {
    /*
     * Six doors are drawn in it and nothing else is. A page that merely
     * *belongs* to a person is not a door.
     */
    const room = CSS.slice(CSS.indexOf(".auth-panel {"), CSS.indexOf(".auth-panel::before"));
    expect(room).toContain("--color-primary-night");

    for (const source of [HEADING, STAFF, read("app", "account", "page.tsx")]) {
      expect(source).not.toContain("auth-panel");
    }
  });

  it("writes on it in the page's ordinary ink, which the gradient was measured for", () => {
    /*
     * Darkest patch is where the two lights overlap: #E0DABF. Ink reads
     * 11.21:1 on it, ink-soft 5.64:1, accent-ink 6.03:1 — so a band needs no
     * palette of its own, and nothing on one is ever white.
     */
    for (const [name, source] of [
      ["page heading", HEADING],
      ["desk heading", STAFF],
      ["desk eyebrow", read("components", "layout", "desk-eyebrow.tsx")],
      ["account greeting", read("app", "account", "page.tsx")],
      ["a book's page", read("app", "books", "[code]", "page.tsx")],
    ] as const) {
      const after = source.slice(source.indexOf("theme-band"));
      expect(after.slice(0, 900), name).not.toMatch(/text-white/);
    }
  });

  it("carries the mark's own rule, unchanged, because the ground is paper again", () => {
    expect(CSS).not.toContain("garden-rule-light");
    expect(HEADING).toMatch(/className="garden-rule relative inline-block/);
    expect(STAFF).toMatch(/className="garden-rule relative inline-block/);
  });

  it("gives the desk a shorter one, because the desk is where space is bought", () => {
    const header = STAFF.slice(STAFF.indexOf('<header className="theme-band'));
    // No butterfly and no sentence: two lines, not five.
    expect(header.slice(0, 400)).not.toContain("Butterfly");
    expect(STAFF).toMatch(/theme-band[^"]*px-5 py-4/);
  });
});

describe("the masthead actually sticks", () => {
  /*
   * It did not, for four commits, and the class was on the element the whole
   * time. `.masthead` sets `position: sticky` inside a `min-width: 768px` query
   * in the components layer; the element also carried Tailwind's `relative`,
   * and the utilities layer is cascaded after components — so the utility won,
   * the header scrolled away, and nothing about it looked wrong in the source.
   *
   * This is the general trap, not a one-off: any component class that sets a
   * property a utility can also set will lose to that utility, quietly.
   */
  const SITE = read("components", "layout", "site-shell.tsx");
  const CSS = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

  it("still asks for sticky from tablet width up", () => {
    const rule = CSS.slice(CSS.indexOf(".masthead {"), CSS.indexOf(".door {"));
    expect(rule).toMatch(/@media \(min-width: 768px\)[\s\S]*?position: sticky/);
  });

  it("hands the header no position utility to override it with", () => {
    const tag = SITE.slice(SITE.indexOf("<header className="), SITE.indexOf("<header className=") + 90);
    expect(tag).toContain('className="masthead"');
    expect(tag).not.toMatch(/\b(relative|absolute|fixed|static|sticky)\b/);
  });
});
