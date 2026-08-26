import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHANGEABLE_FIELDS,
  CHANGEABLE_FIELD_KEYS,
  CHANGE_MESSAGES,
  NOT_CHANGEABLE,
  collectChanges,
  validateChanges,
} from "@/lib/profile-changes";
import { ROLE_DEFINITIONS } from "@/lib/permissions";

/**
 * A reader asking for their own details to be corrected.
 *
 * The property everything else depends on: **asking writes nothing.** A reader
 * holds `profile.request_change`, which puts a proposal in a queue and changes
 * not one field of their account. That is what makes it safe to put the
 * guardian's email address — the one a password-reset link is delivered to — on
 * a form a nine-year-old can fill in.
 */

describe("what a reader may propose", () => {
  it("cannot propose their own birth year", () => {
    /*
     * The one field that could be edited to stay past the library's range, and
     * therefore the one a reader must not be able to touch. A librarian corrects
     * it, having seen the registration it came from.
     */
    expect(CHANGEABLE_FIELD_KEYS).not.toContain("birthYear");
    expect(NOT_CHANGEABLE.birthYear).toMatch(/librarian/i);
  });

  it("cannot propose a card number, a status or a role", () => {
    for (const key of ["memberCode", "status", "role", "permissions", "staffNotes", "joinedAt"]) {
      expect(CHANGEABLE_FIELD_KEYS).not.toContain(key);
    }
  });

  it("flags the field that moves where a reset link is delivered", () => {
    const email = CHANGEABLE_FIELDS.find((field) => field.key === "guardianEmail");
    expect(email?.affectsRecovery).toBe(true);

    // Exactly one. If a second field ever gains this property the review screen
    // needs to know, and this assertion is where somebody finds out.
    expect(CHANGEABLE_FIELDS.filter((field) => field.affectsRecovery)).toHaveLength(1);
  });
});

describe("collecting what actually changed", () => {
  const current = {
    displayName: "Aarav",
    apartment: "P-15",
    guardianName: "Priya",
    guardianEmail: "priya@example.invalid",
    guardianPhone: "9000000000",
  };

  /**
   * The subtle one, and the reason this function exists.
   *
   * A form posts every box. Without this, a reader fixing one letter of their
   * flat number also submits a request to "change" their guardian's email to
   * the string it already is — and the desk is asked to approve a
   * recovery-address change nobody meant to make.
   */
  it("drops fields that are unchanged", () => {
    const changes = collectChanges({ ...current, apartment: "B-204" }, current);
    expect(changes).toEqual({ apartment: "B-204" });
  });

  it("drops empty boxes rather than blanking a field", () => {
    expect(collectChanges({ ...current, guardianPhone: "   " }, current)).toEqual({});
  });

  it("ignores anything that is not on the list", () => {
    const changes = collectChanges(
      { ...current, birthYear: "1990", status: "ACTIVE", memberCode: "X-1" } as Record<string, string>,
      current,
    );
    expect(changes).toEqual({});
  });

  it("treats surrounding whitespace as no change", () => {
    expect(collectChanges({ ...current, displayName: "  Aarav  " }, current)).toEqual({});
  });
});

describe("validation", () => {
  it("refuses an address that is not one", () => {
    expect(validateChanges({ guardianEmail: "not-an-email" })).toHaveProperty("guardianEmail");
    expect(validateChanges({ guardianEmail: "priya@example.invalid" })).toEqual({});
  });

  it("holds a flat number to the same shape the joining form does", () => {
    expect(validateChanges({ apartment: "B-204" })).toEqual({});
    expect(validateChanges({ apartment: "<script>" })).toHaveProperty("apartment");
  });

  it("refuses a field that is not on the list, even if one is smuggled in", () => {
    expect(validateChanges({ birthYear: "1990" })).toHaveProperty("birthYear");
  });
});

describe("asking is not doing", () => {
  const service = readFileSync("src/server/services/profile-change-service.ts", "utf8");

  /**
   * The whole safety property, asserted at the source.
   *
   * `submitProfileChange` may create a row in its own table and nothing else.
   * The moment it writes to appUser, memberProfile or guardian, a child is
   * editing their own account and the approval step is decoration.
   */
  it("writes only to its own queue when a reader submits", () => {
    const start = service.indexOf("export async function submitProfileChange");
    const end = service.indexOf("export async function withdrawOwnProfileChange");
    const submit = service.slice(start, end);

    expect(submit).toContain("tx.profileChangeRequest.create");
    expect(submit).not.toMatch(/tx\.appUser\.update/);
    expect(submit).not.toMatch(/tx\.memberProfile\.update/);
    expect(submit).not.toMatch(/tx\.guardian\.update/);
  });

  it("takes no member id from the caller", () => {
    // Ownership is from the session. There is nothing in the request for a
    // curious reader to point at somebody else's account.
    expect(service).toMatch(
      /export async function submitProfileChange\(\s*submitted: Record<string, string \| undefined>,\s*note: string,\s*\)/,
    );
    expect(service).toContain("export async function getOwnProfile(): Promise<OwnProfileView | null>");
  });

  it("applies the values only when somebody approves", () => {
    const decide = service.slice(service.indexOf("export async function decideProfileChange"));

    expect(decide).toContain('requirePermission("profile_change.review")');
    expect(decide).toContain("tx.appUser.update");
    expect(decide).toContain("tx.guardian.update");
    // …and only on the approving branch.
    expect(decide).toContain("if (approve) {");
  });

  /**
   * A link already sitting in the old inbox points at an address that is being
   * replaced. It must not still work afterwards — the same rule the desk's own
   * contact edit follows.
   */
  it("kills live links when the recovery address moves", () => {
    const decide = service.slice(service.indexOf("export async function decideProfileChange"));

    expect(decide).toContain("emailChanged");
    expect(decide).toContain('revokeTokens(tx, request.memberUserId, "PASSWORD_RESET")');
    expect(decide).toContain('revokeTokens(tx, request.memberUserId, "ACTIVATION")');
  });

  it("re-checks the values at approval time, not only at submission", () => {
    const decide = service.slice(service.indexOf("export async function decideProfileChange"));
    // The rules can move between a reader asking and the desk answering.
    expect(decide).toContain("validateChanges(proposed)");
  });

  /**
   * The log records WHICH fields a family changed, never what to.
   *
   * The audit log is read during incidents and exported to a spreadsheet. A
   * metadata blob carrying the old and new guardian email would quietly make it
   * a second copy of the very details it exists to keep track of — and one
   * nobody ever deletes from.
   */
  it("logs which fields changed and never their values", () => {
    const blocks = service.match(/metadata: \{[\s\S]*?\}/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      if (!block.includes("proposed")) continue;
      // Passing the proposal itself would put the values in the log. Only its
      // keys — the field names — may go in.
      expect(block).toContain("Object.keys(proposed)");
      expect(block).not.toMatch(/proposed(?!\))(?!\s*\))[^.]/);
    }
  });
});

describe("who decides", () => {
  it("keeps approval with the Super Admin alone", () => {
    for (const role of ROLE_DEFINITIONS) {
      if (role.key === "SUPER_ADMIN") continue;
      expect(role.permissions).not.toContain("profile_change.review");
    }

    const superAdmin = ROLE_DEFINITIONS.find((role) => role.key === "SUPER_ADMIN");
    expect(superAdmin?.permissions).toContain("profile_change.review");
  });

  it("lets a reader ask, and only ask", () => {
    const member = ROLE_DEFINITIONS.find((role) => role.key === "MEMBER");
    expect(member?.permissions).toContain("profile.request_change");
    expect(member?.permissions).not.toContain("profile_change.review");
    expect(member?.permissions).not.toContain("member.edit");
  });
});

describe("the words a reader reads", () => {
  it("says plainly that nothing has changed yet", () => {
    expect(CHANGE_MESSAGES.intro).toMatch(/nothing changes until/i);
    expect(CHANGE_MESSAGES.submitted).toMatch(/nothing has changed/i);
    expect(CHANGE_MESSAGES.pendingBody).toMatch(/nothing changes until/i);
  });
});
