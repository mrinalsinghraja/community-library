/**
 * The permission catalogue.
 *
 * Authorization is data, not control flow: nothing in this application decides
 * access with `if (role === "LIBRARIAN")`. Roles map to permission keys in the
 * database, and services ask `can(actor, "loan.issue")`.
 *
 * This file is the seed source for the `permission` and `role_permission`
 * tables. It is intentionally isomorphic (no server-only import) so that the
 * seed scripts, the services and the tests all read the same list.
 */

export const PERMISSIONS = {
  // --- Registrations --------------------------------------------------------
  "registration.view": { category: "registrations", description: "See pending registration requests" },
  "registration.review": { category: "registrations", description: "Approve or reject a registration" },

  // --- Members --------------------------------------------------------------
  "member.view": { category: "members", description: "See the member list and member profiles" },
  "member.view_contact": {
    category: "members",
    description: "See guardian contact details (phone, email)",
  },
  "member.create": { category: "members", description: "Create a member account" },
  "member.edit": { category: "members", description: "Edit member details" },
  "member.suspend": { category: "members", description: "Suspend or reactivate a member" },
  "member.reset_password": {
    category: "members",
    description: "Send a password reset or fresh activation link (never reveals a password)",
  },

  // --- Catalogue ------------------------------------------------------------
  "book.view": { category: "catalogue", description: "Browse the book catalogue" },
  "book.create": { category: "catalogue", description: "Add a book title or copy" },
  "book.edit": { category: "catalogue", description: "Edit book details" },
  "book.archive": { category: "catalogue", description: "Archive a copy (reversible)" },
  "book.delete": { category: "catalogue", description: "Permanently delete a book record" },

  // --- Donations ------------------------------------------------------------
  "donation.view": { category: "donations", description: "See donation records" },
  "donation.record": { category: "donations", description: "Record a donated book" },
  "donation.view_private": {
    category: "donations",
    description: "See the real donor behind an anonymous credit",
  },

  // --- Circulation ----------------------------------------------------------
  "loan.issue": { category: "circulation", description: "Give a book to a reader" },
  "loan.return": { category: "circulation", description: "Take a book back" },
  "loan.renew": { category: "circulation", description: "Extend a loan" },
  "loan.override_rules": {
    category: "circulation",
    description: "Issue or renew outside the configured limits",
  },
  "loan.mark_lost": { category: "circulation", description: "Mark a copy lost or damaged" },

  // --- Library operations ---------------------------------------------------
  "report.view": { category: "reports", description: "See library reports" },
  "announcement.manage": { category: "operations", description: "Publish library announcements" },

  // --- Administration -------------------------------------------------------
  "settings.view": { category: "administration", description: "View library settings" },
  "settings.edit": { category: "administration", description: "Change library rules and settings" },
  "branding.edit": { category: "administration", description: "Change logo, colours and names" },
  "user.manage_staff": { category: "administration", description: "Create and manage staff accounts" },
  "role.manage": { category: "administration", description: "Change roles and permissions" },
  "audit.view": { category: "administration", description: "Read the audit log" },
  "email.configure": { category: "administration", description: "Configure email delivery" },
} as const satisfies Record<string, { category: string; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = {
  SUPER_ADMIN: "SUPER_ADMIN",
  LIBRARIAN: "LIBRARIAN",
  JUNIOR_LIBRARIAN: "JUNIOR_LIBRARIAN",
  MEMBER: "MEMBER",
  GUARDIAN: "GUARDIAN",
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  /** Seeded roles that cannot yet be granted (JUNIOR_LIBRARIAN in v1). */
  isAssignable: boolean;
  sortOrder: number;
  permissions: readonly PermissionKey[];
}

const LIBRARIAN_PERMISSIONS = [
  "registration.view",
  "registration.review",
  "member.view",
  "member.view_contact",
  "member.create",
  "member.edit",
  "member.suspend",
  "member.reset_password",
  "book.view",
  "book.create",
  "book.edit",
  "book.archive",
  "donation.view",
  "donation.record",
  "donation.view_private",
  "loan.issue",
  "loan.return",
  "loan.renew",
  "loan.override_rules",
  "loan.mark_lost",
  "report.view",
  "announcement.manage",
] as const satisfies readonly PermissionKey[];

/**
 * Seeded now, granted later. Proving the RBAC model can express this role
 * without code changes is the whole point of seeding it in Phase 0.
 *
 * Deliberately excluded: anything touching guardian contact details, passwords,
 * settings, deletion, or rule overrides.
 */
const JUNIOR_LIBRARIAN_PERMISSIONS = [
  "book.view",
  "loan.issue",
  "loan.return",
  "member.view",
] as const satisfies readonly PermissionKey[];

const MEMBER_PERMISSIONS = ["book.view"] as const satisfies readonly PermissionKey[];

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: ROLE_KEYS.SUPER_ADMIN,
    name: "Super Admin",
    description: "Full administrative authority over the library and its configuration.",
    isAssignable: true,
    sortOrder: 10,
    // Super Admin holds every permission by definition; kept explicit so a new
    // permission is a deliberate grant rather than an accidental one.
    permissions: PERMISSION_KEYS,
  },
  {
    key: ROLE_KEYS.LIBRARIAN,
    name: "Librarian",
    description: "Runs the library day to day: registrations, books, issue and return.",
    isAssignable: true,
    sortOrder: 20,
    permissions: LIBRARIAN_PERMISSIONS,
  },
  {
    key: ROLE_KEYS.JUNIOR_LIBRARIAN,
    name: "Junior Librarian",
    description:
      "A child volunteer helping at the desk. Seeded for the future; not assignable in Version 1.",
    isAssignable: false,
    sortOrder: 30,
    permissions: JUNIOR_LIBRARIAN_PERMISSIONS,
  },
  {
    key: ROLE_KEYS.MEMBER,
    name: "Reader",
    description: "A child member of the library.",
    isAssignable: true,
    sortOrder: 40,
    permissions: MEMBER_PERMISSIONS,
  },
  {
    key: ROLE_KEYS.GUARDIAN,
    name: "Parent or Guardian",
    description: "A contactable adult responsible for a reader. Cannot sign in in Version 1.",
    isAssignable: true,
    sortOrder: 50,
    permissions: [],
  },
] as const;

/**
 * Permissions that must never be granted to a role marked as a child volunteer.
 * Enforced by a test so a future edit cannot quietly widen the junior role.
 */
export const PERMISSIONS_FORBIDDEN_FOR_CHILD_STAFF: readonly PermissionKey[] = [
  "member.view_contact",
  "member.reset_password",
  "member.create",
  "member.suspend",
  "book.delete",
  "loan.override_rules",
  "settings.view",
  "settings.edit",
  "branding.edit",
  "user.manage_staff",
  "role.manage",
  "audit.view",
  "email.configure",
  "donation.view_private",
] as const;

export function permissionsForRole(key: RoleKey): readonly PermissionKey[] {
  const role = ROLE_DEFINITIONS.find((r) => r.key === key);
  if (!role) throw new Error(`Unknown role: ${key}`);
  return role.permissions;
}
