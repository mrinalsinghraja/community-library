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
  "member.deactivate": {
    category: "members",
    description: "Close a member account when a family leaves (history is retained)",
  },
  "member.reset_password": {
    category: "members",
    description: "Send a password reset or fresh activation link (never reveals a password)",
  },
  "guardian.edit": {
    category: "members",
    description:
      "Change guardian contact details, including the email that receives recovery links",
  },
  "member.manage_photo": {
    category: "members",
    description: "Replace or remove a child's photograph",
  },
  "guardian.verify": {
    category: "members",
    description: "Record that a guardian has been verified, and by what method",
  },

  // --- Catalogue ------------------------------------------------------------
  "book.view": { category: "catalogue", description: "Browse the book catalogue" },
  "book.create": { category: "catalogue", description: "Add a book title or copy" },
  "book.edit": { category: "catalogue", description: "Edit book details" },
  "book.archive": { category: "catalogue", description: "Archive a copy (reversible)" },
  "book.delete": { category: "catalogue", description: "Permanently delete a book record" },
  "category.manage": {
    category: "catalogue",
    description: "Add, rename or retire the shelves books are filed under",
  },

  // --- Donations ------------------------------------------------------------
  "donation.view": { category: "donations", description: "See donation records" },
  "donation.record": { category: "donations", description: "Record a donated book" },
  "donation.view_private": {
    category: "donations",
    description: "See the real donor behind an anonymous credit",
  },

  // --- Circulation ----------------------------------------------------------
  //
  // `loan.view` is held by staff AND by every reader, and the two mean different
  // things: a librarian sees the desk's loans, a child sees their own. That is
  // not decided here. `listOwnLoans` takes no id and reads the session; the
  // staff queries require an operational permission a reader does not hold. The
  // same key cannot widen a child's view because no code path lets it.
  "loan.view": { category: "circulation", description: "See loans — your own, or the desk's" },
  "loan.issue": { category: "circulation", description: "Give a book to a reader" },
  "loan.return": { category: "circulation", description: "Take a book back" },
  // Held by staff, and the authority behind BOTH ways a loan gets extended:
  // renewing at the desk, and approving a child's request. Approving one does
  // exactly what the desk button does, through exactly the same transaction, so
  // a second permission would describe the same power twice and let the two
  // drift apart. See ADR-030.
  "loan.renew": { category: "circulation", description: "Extend a loan" },
  // Held by readers, and by readers only. It permits asking; it decides
  // nothing. The service behind it takes no member id — ownership comes from
  // the session — so this grant cannot be stretched into touching another
  // child's loan.
  "loan.request_renewal": {
    category: "circulation",
    description: "Ask a librarian to keep a book you have borrowed for longer",
  },
  "loan.correct": {
    category: "circulation",
    description: "Repair a loan that went wrong — cancel a mis-issue, or close a loan the system missed",
  },
  "loan.override_rules": {
    category: "circulation",
    description: "Not yet implemented — nothing in the application reads this",
  },
  "loan.mark_lost": {
    // A copy's condition and status are changed through the catalogue, guarded
    // by `book.edit`. This key has never guarded anything.
    category: "circulation",
    description: "Not yet implemented — nothing in the application reads this",
  },

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

/**
 * Permissions that exist in the model and change nothing when granted.
 *
 * They were seeded in Phase 0 to prove the RBAC model could express the roles
 * the blueprint describes, and no phase since has given them meaning. Granting
 * one today has exactly one effect: a row in `role_permission`.
 *
 * The list is here so that a role screen, whenever one is built, has to decide
 * what to do about them rather than discovering the problem after somebody has
 * ticked a box and gone home believing the library behaves differently. A
 * permission that looks like a rule but is not one is worse than a missing
 * feature — it is a promise the software will not keep.
 *
 * Implementing one means giving it semantics, and semantics for these are the
 * owner's to define, not the code's to guess. Take a key off this list in the
 * same change that makes it do something.
 */
export const DORMANT_PERMISSIONS = ["loan.override_rules", "loan.mark_lost"] as const satisfies
  readonly PermissionKey[];

export function isDormantPermission(key: PermissionKey): boolean {
  return (DORMANT_PERMISSIONS as readonly PermissionKey[]).includes(key);
}

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
  "member.deactivate",
  "member.reset_password",
  "guardian.edit",
  "member.manage_photo",
  "guardian.verify",
  "book.view",
  "book.create",
  "book.edit",
  "book.archive",
  "category.manage",
  "donation.view",
  "donation.record",
  "donation.view_private",
  "loan.view",
  "loan.issue",
  "loan.return",
  "loan.renew",
  "loan.correct",
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
  "loan.view",
  "loan.issue",
  "loan.return",
  "loan.renew",
  "member.view",
] as const satisfies readonly PermissionKey[];

/**
 * A reader.
 *
 * `loan.view` here means one thing only: their own books. The service that
 * backs the child's screen takes no member id at all — it reads the session —
 * so this grant cannot be stretched into seeing somebody else's. Readers hold
 * no circulation *mutation* permission: a child never issues, returns, renews
 * or cancels anything, in this phase or any other.
 */
const MEMBER_PERMISSIONS = [
  "book.view",
  "loan.view",
  // Asking is not mutating a loan. A request changes nothing about the book,
  // the date or the record until a librarian decides — which is the whole
  // reason it is a request and not a renewal.
  "loan.request_renewal",
] as const satisfies readonly PermissionKey[];

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
  "member.deactivate",
  "guardian.edit",
  // A child volunteer at the desk must never be able to handle another child's
  // photograph or to assert that an adult has been verified.
  "member.manage_photo",
  "guardian.verify",
  "book.delete",
  "loan.override_rules",
  // Correcting circulation state means editing what the record says happened.
  // A child volunteer may hand books out and take them back all day; rewriting
  // the library's own account of a loan is an adult's responsibility.
  "loan.correct",
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
