import { describe, expect, it } from "vitest";

import {
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

  it("gives a member nothing beyond browsing and their own books", () => {
    /*
     * Two read permissions, and no mutation permission of any kind. A child
     * never issues, returns, renews or cancels anything.
     *
     * `loan.view` is scoped by ownership rather than by the grant: the service
     * behind a child's screen takes no member id at all and reads the session,
     * so holding this key cannot be stretched into seeing somebody else's
     * books. The corollary is the trap — because every reader holds it, a staff
     * screen may never be guarded by it. See the circulation tests.
     */
    expect(permissionsForRole(ROLE_KEYS.MEMBER)).toEqual(["book.view", "loan.view"]);
  });

  it("gives a member no way to change anything", () => {
    const member = permissionsForRole(ROLE_KEYS.MEMBER);
    for (const permission of member) {
      expect(permission.endsWith(".view")).toBe(true);
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
