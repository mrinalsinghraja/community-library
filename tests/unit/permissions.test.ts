import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLE_KEYS,
  ASSIGNABLE_STAFF_ROLE_KEYS,
  DESTRUCTIVE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSIONS_FORBIDDEN_FOR_CHILD_STAFF,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  permissionsForRole,
} from "@/lib/permissions";

describe("permission catalogue", () => {
  it("gives every permission a category and a description", () => {
    for (const [key, meta] of Object.entries(PERMISSIONS)) {
      expect(meta.category, `${key} has no category`).toBeTruthy();
      expect(meta.description, `${key} has no description`).toBeTruthy();
    }
  });

  it("only grants permissions that actually exist", () => {
    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) {
        expect(PERMISSION_KEYS, `${role.key} grants unknown permission ${permission}`).toContain(
          permission,
        );
      }
    }
  });
});

describe("role definitions", () => {
  it("gives Super Admin every permission", () => {
    expect([...permissionsForRole(ROLE_KEYS.SUPER_ADMIN)].sort()).toEqual(
      [...PERMISSION_KEYS].sort(),
    );
  });

  it("never lets a librarian change settings, roles or the audit log", () => {
    const librarian = permissionsForRole(ROLE_KEYS.LIBRARIAN);
    for (const forbidden of [
      "settings.edit",
      "branding.edit",
      "role.manage",
      "user.manage_staff",
      "audit.view",
      "book.delete",
      "email.configure",
    ] as const) {
      expect(librarian, `librarian must not hold ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never lets a librarian decide a child's registration or close a membership", () => {
    /*
     * The two that moved to the Super Admin in Version 1, and the reason each
     * one moved.
     *
     * `registration.review` decides whether a child becomes a member of this
     * library. A librarian sees the queue and meets the family — they keep
     * `registration.view` — but the owner of the library says yes or no.
     *
     * `member.deactivate` ends a membership when a family leaves the building.
     * It is not a mistake a librarian should be able to make at a busy desk,
     * and it belongs with whoever approved the child in the first place.
     */
    const librarian = permissionsForRole(ROLE_KEYS.LIBRARIAN);

    expect(librarian).not.toContain("registration.review");
    expect(librarian).not.toContain("member.deactivate");

    // What they keep: seeing the queue, and everything reversible.
    expect(librarian).toContain("registration.view");
    expect(librarian).toContain("member.suspend");
    expect(librarian).toContain("book.edit");
    expect(librarian).toContain("book.archive");
  });

  it("keeps every destructive permission with the Super Admin alone", () => {
    // Deletion, final approval and staff management are the Super Admin's. The
    // list is in the model rather than implied by an absence, so a future edit
    // that grants one of these to another role fails here.
    for (const role of ROLE_DEFINITIONS) {
      if (role.key === ROLE_KEYS.SUPER_ADMIN) continue;

      for (const destructive of DESTRUCTIVE_PERMISSIONS) {
        expect(
          role.permissions,
          `${role.key} must not hold ${destructive}`,
        ).not.toContain(destructive);
      }
    }
  });

  it("keeps the child volunteer role away from anything sensitive", () => {
    // This is the test that stops a future edit quietly widening the junior
    // role. Children helping at the desk must never reach parent contact
    // details, passwords, settings or deletion.
    const junior = permissionsForRole(ROLE_KEYS.JUNIOR_LIBRARIAN);

    for (const forbidden of PERMISSIONS_FORBIDDEN_FOR_CHILD_STAFF) {
      expect(junior, `junior librarian must not hold ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("seeds the junior librarian role but does not make it assignable in v1", () => {
    const junior = ROLE_DEFINITIONS.find((role) => role.key === ROLE_KEYS.JUNIOR_LIBRARIAN);
    expect(junior).toBeDefined();
    expect(junior?.isAssignable).toBe(false);
  });

  it("has exactly three assignable roles: Super Admin, Librarian, Reader", () => {
    /*
     * The whole of the Version 1 role model, asserted in one line.
     *
     * Five roles are seeded and two of them grant nothing to anybody:
     * JUNIOR_LIBRARIAN is waiting for a version that has child volunteers, and
     * GUARDIAN describes an adult the library writes to rather than an account
     * that signs in. `getActor` skips a non-assignable role even if a stale
     * user_role row still points at it, so a dormant role is closed rather than
     * merely hidden.
     */
    expect([...ASSIGNABLE_ROLE_KEYS].sort()).toEqual(
      [ROLE_KEYS.LIBRARIAN, ROLE_KEYS.MEMBER, ROLE_KEYS.SUPER_ADMIN].sort(),
    );

    expect(ASSIGNABLE_ROLE_KEYS).not.toContain(ROLE_KEYS.JUNIOR_LIBRARIAN);
    expect(ASSIGNABLE_ROLE_KEYS).not.toContain(ROLE_KEYS.GUARDIAN);
  });

  it("lets the staff screen create Librarians and nothing else", () => {
    // There is exactly one Super Admin, made by `npm run create-admin` when the
    // library is set up. No screen mints a second.
    expect(ASSIGNABLE_STAFF_ROLE_KEYS).toEqual([ROLE_KEYS.LIBRARIAN]);
  });

  it("keeps the guardian role dormant, granting nothing to nobody", () => {
    const guardian = ROLE_DEFINITIONS.find((role) => role.key === ROLE_KEYS.GUARDIAN);
    expect(guardian?.isAssignable).toBe(false);
    expect(guardian?.permissions).toEqual([]);
  });

  it("gives a member nothing beyond browsing and their own books", () => {
    /*
     * Two read permissions, and no permission that decides anything. A child
     * never issues, returns, renews or cancels anything: the three request keys
     * write into a queue somebody else answers, and `loan.announce_return`
     * writes a note that moves no book.
     *
     * `loan.view` is scoped by ownership rather than by the grant: the service
     * behind a child's screen takes no member id at all and reads the session,
     * so holding this key cannot be stretched into seeing somebody else's
     * books. The corollary is the trap — because every reader holds it, a staff
     * screen may never be guarded by it. See the circulation tests.
     */
    expect(permissionsForRole(ROLE_KEYS.MEMBER)).toEqual([
      "book.view",
      "loan.view",
      // Version 1. Asking for a book is not taking one off the shelf: it
      // writes a row saying a child would like it, and moves no book, no copy
      // status and no due date until a librarian answers.
      "loan.request",
      // Phase 4. Asking is not deciding: it writes a row that says a child
      // would like to keep a book, and changes nothing about the book, the
      // date, or the loan until a librarian answers.
      "loan.request_renewal",
      // Phase 5. The one reader key that is NOT a request, because there is
      // nothing to decide: a child bringing a book back cannot be refused. It
      // is still not a mutation of the loan — it writes a note saying the book
      // is on its way, and the copy stays BORROWED and the loan stays ACTIVE
      // until a librarian takes the book in at the desk. A child cannot put a
      // book back on the shelf from their sofa. See ADR-062.
      "loan.announce_return",
      // Version 1. The same shape a third time, and the one where it matters
      // most: this lets a reader propose a correction to their own details —
      // including the guardian email their password-reset link is delivered
      // to — and write it NOWHERE except a queue. The values reach the record
      // only when somebody holding `profile_change.review` approves them, and
      // that key belongs to the Super Admin alone. A reader holding this
      // cannot change a single field of their own account.
      "profile.request_change",
    ]);
  });

  it("gives a member no way to change a loan", () => {
    /*
     * The rule is not "readers hold only .view keys" — that was true until a
     * child could ask for something. The rule is that no permission a reader
     * holds can move a due date, hand out a book, take one back, or rewrite
     * what the library says happened. Those four are the whole of circulation's
     * write surface, and a reader holds none of them.
     */
    const member = permissionsForRole(ROLE_KEYS.MEMBER);
    const mutations = ["loan.issue", "loan.return", "loan.renew", "loan.correct"];

    for (const mutation of mutations) {
      expect(member).not.toContain(mutation);
    }
  });

  it("gives a guardian no permissions at all in v1", () => {
    expect(permissionsForRole(ROLE_KEYS.GUARDIAN)).toEqual([]);
  });

  it("has no duplicate role keys", () => {
    const keys = ROLE_DEFINITIONS.map((role) => role.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
