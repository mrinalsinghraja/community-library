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
  /**
   * Decide a correction a reader has asked for.
   *
   * Super Admin only, by the owner's decision, and the separation from
   * `member.edit` is the point rather than an accident. A librarian correcting
   * a misspelt name is ordinary desk work. Approving a change a *child*
   * proposed is a different act: one of the fields on that form is the address
   * their password-reset link goes to, so saying yes to it moves the account's
   * recovery path to a different inbox.
   */
  "profile_change.review": {
    category: "members",
    description: "Approve or refuse a correction a reader has asked for",
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
  /**
   * Decide whether a reader's review goes onto the book's page.
   *
   * Separate from `book.edit` on purpose, and the separation is the point.
   * Editing a book is a fact about the collection; approving a review is a
   * judgement about a child's writing, made before anybody else can read it.
   * Both Librarian and Super Admin hold it — the queue has to be worked by
   * whoever is at the desk, and a moderation queue only one person can clear is
   * a queue that fills up.
   */
  "review.moderate": {
    category: "catalogue",
    description: "Approve or decline a reader's review before it is published",
  },
  /**
   * Erase a published review.
   *
   * Super Admin only, and deliberately not granted with `review.moderate`.
   * Publication is permanent by design: the author cannot take a review back
   * and a librarian cannot quietly un-publish one. This key is the single
   * exception, it is irreversible, and it is held by the owner of the library
   * alone — the same reasoning that keeps `book.delete` and `user.delete` out
   * of the Librarian role.
   */
  "review.delete": {
    category: "catalogue",
    description: "Permanently delete a published review",
  },
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
  //
  // `loan.request` is the same shape for a book the child has not got yet:
  // finding a book in the catalogue is not taking it off the shelf. The book
  // leaves the room when a librarian issues it, and `loan.issue` is still the
  // only authority that can do that — approving a request runs the same
  // transaction as the desk button. See ADR-038.
  "loan.request": {
    category: "circulation",
    description: "Ask a librarian to borrow a book you have found in the catalogue",
  },
  /**
   * Ask for your own details to be corrected.
   *
   * Named like `loan.request` and for the same reason: asking is not doing.
   * Holding this changes no record — it lets a reader put a proposal in a queue
   * that somebody else decides. See src/lib/profile-changes.ts.
   */
  "profile.request_change": {
    category: "members",
    description: "Ask for your own details to be corrected",
  },
  "loan.request_renewal": {
    category: "circulation",
    description: "Ask a librarian to keep a book you have borrowed for longer",
  },
  /**
   * Tell the library a book is coming back.
   *
   * Named `announce` and not `request` because there is nothing to decide: a
   * child bringing a book back cannot be refused. And named neither `return`
   * nor `close` because it does not end the loan — the book is still at their
   * home, the copy is still BORROWED, and a librarian records the real return
   * with it in their hands. See ADR-062.
   */
  "loan.announce_return": {
    category: "circulation",
    description: "Tell the library you are bringing a book back",
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
  /**
   * Take a list out of the library as a file.
   *
   * Seeded in Phase 0 and dormant until Version 1 gave it meaning. It is the
   * authority to export, and only that — it widens nothing. Every report is
   * loaded by the service that already owns the corresponding screen, so this
   * key lets a person save what they can already read and nothing more. A
   * librarian holding it still cannot export the audit log, because the audit
   * service asks for `audit.view`. See ADR-045.
   */
  "report.view": {
    category: "reports",
    description: "Export a list you can already see, as a spreadsheet or a PDF",
  },
  /**
   * Put a notice on the board every reader sees, or take one down.
   *
   * Super Admin only, by the owner's decision. The board is the one surface in
   * this application that speaks to every family at once and is not about a
   * book — the same property that makes it useful makes it the wrong thing to
   * hand out widely. A librarian who needs something said asks for it to be
   * posted, which is a conversation and takes a minute.
   */
  "announcement.manage": {
    category: "operations",
    description: "Post a notice to every reader's page, or take one down",
  },
  /**
   * Put up the times the library room is open.
   *
   * Held by Librarian and Super Admin both: this is the desk saying when it
   * will be standing behind it, and the person who will be there is the person
   * who should be able to say so.
   */
  "visit.manage": {
    category: "operations",
    description: "Set the times readers can come to the library room",
  },
  /**
   * Call off a time that readers have already been shown.
   *
   * Deliberately NOT on `visit.manage`, and the split is the point. Adding a
   * time is an offer; cancelling one is breaking an offer a family has already
   * read and may have planned a Saturday around. Only the Super Admin does
   * that, which is the same shape as every other undo-a-published-thing key in
   * this application.
   */
  "visit.cancel": {
    category: "operations",
    description: "Cancel a visiting time readers have already been shown",
  },

  // --- Administration -------------------------------------------------------
  "settings.view": { category: "administration", description: "View library settings" },
  "settings.edit": { category: "administration", description: "Change library rules and settings" },
  "branding.edit": { category: "administration", description: "Change logo, colours and names" },
  "user.manage_staff": { category: "administration", description: "Create and manage staff accounts" },
  /**
   * Erase an account that has no library history.
   *
   * Deliberately separate from `member.deactivate` and `user.manage_staff`.
   * Closing an account is a lifecycle change that keeps the record; this key
   * removes the record, and the two should never be reachable through the same
   * grant. Only SUPER_ADMIN holds it, and the services behind it refuse
   * anything that has borrowed, asked, been photographed or acted.
   */
  "user.delete": {
    category: "administration",
    description: "Permanently delete an account that has no library history",
  },
  "role.manage": {
    category: "administration",
    description: "Not yet implemented — nothing in the application reads this",
  },
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
export const DORMANT_PERMISSIONS = [
  "loan.override_rules",
  "loan.mark_lost",
  // `report.view` left this list in Version 1, in the change that gave it
  // meaning — which is the rule this comment block asks for. It now guards the
  // export of every desk listing.
  //
  // `announcement.manage` left it the same way, in the change that built the
  // notice board. It had sat here since Phase 0 looking like a capability and
  // being none.
  // Joined the list in Version 1, when the role editor was removed. There are
  // exactly three assignable roles and one Super Admin; the only role the staff
  // screen grants is Librarian, at creation. Nothing reads this key, and the
  // honest place for a permission that guards nothing is here — not quietly
  // sitting on the Super Admin's list looking like a capability.
  "role.manage",
] as const satisfies readonly PermissionKey[];

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
  // A librarian sees the queue and the family's details, because they are the
  // ones who will meet the child. They do not decide it: `registration.review`
  // is Super Admin only, so no child account comes into existence — and no
  // child's registration is refused — without the owner of the library saying
  // so. See ADR-037.
  "registration.view",
  "member.view",
  "member.view_contact",
  "member.create",
  "member.edit",
  "member.suspend",
  // `member.deactivate` is deliberately absent. Suspending is a pause a
  // librarian can undo; closing the account of a family who has left the
  // apartment is the end of someone's membership, and belongs with the person
  // who approved it in the first place.
  "member.reset_password",
  "guardian.edit",
  "member.manage_photo",
  "guardian.verify",
  "book.view",
  "book.create",
  "book.edit",
  "book.archive",
  // Deciding what a child wrote is desk work. `review.delete` is deliberately
  // absent: a librarian may decline a review before it is published and may not
  // erase one after.
  "review.moderate",
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
  // The desk says when the desk is open. `visit.cancel` is deliberately absent:
  // breaking a time families have already read is the Super Admin's, the same
  // way un-publishing anything else here is.
  "visit.manage",
  // `profile_change.review` is deliberately absent — see the key's own note.
  // Approving what a child proposed for their own guardian's email is the
  // owner's call, not the desk's.
  // `announcement.manage` is deliberately absent — see the key's own note. The
  // notice board reaches every family at once and belongs to the owner.
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
  // Asking for a book is not taking one. A request moves no book, changes no
  // copy status and creates no loan until a librarian approves it.
  "loan.request",
  // Asking is not mutating a loan. A request changes nothing about the book,
  // the date or the record until a librarian decides — which is the whole
  // reason it is a request and not a renewal.
  "loan.request_renewal",
  // Saying a book is on its way back. Changes no record of where the book is —
  // it puts a note on the desk's list so the librarian expects it.
  "loan.announce_return",
  // Asking for a correction changes nothing until somebody approves it, which
  // is exactly the shape of the two keys above.
  "profile.request_change",
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
    // Not assignable, and never was granted: a guardian is a person the library
    // can write to, recorded on the child's registration, not an account that
    // signs in. Nothing in the application grants this role, so marking it
    // dormant takes nothing away from anyone.
    isAssignable: false,
    sortOrder: 50,
    permissions: [],
  },
] as const;

/**
 * The three roles Version 1 will actually hand out: Super Admin, Librarian,
 * Reader.
 *
 * Derived, not typed out again, so that making a role dormant is one edit in
 * one place. JUNIOR_LIBRARIAN and GUARDIAN are seeded and grant nothing —
 * `getActor` skips a non-assignable role even if a stale user_role row still
 * points at it, so a dormant role cannot become a way in.
 */
export const ASSIGNABLE_ROLE_KEYS: readonly RoleKey[] = ROLE_DEFINITIONS.filter(
  (role) => role.isAssignable,
).map((role) => role.key);

/**
 * The only staff role the staff screen can create. Version 1 has exactly one
 * Super Admin, made by `npm run create-admin` when the library is set up; there
 * is no screen anywhere that mints a second one.
 */
export const ASSIGNABLE_STAFF_ROLE_KEYS: readonly RoleKey[] = [ROLE_KEYS.LIBRARIAN];

/**
 * Deletion is the Super Admin's alone.
 *
 * Listed here so the rule is visible in the model rather than implied by the
 * absence of a key from a grant list. A test asserts that no role other than
 * SUPER_ADMIN holds one of these, which is what stops a future edit from
 * quietly handing a librarian the power to erase a record.
 *
 * Everything a librarian needs in order to fix a mistake — editing a book,
 * archiving a copy, suspending a member — is reversible and stays with them.
 */
export const DESTRUCTIVE_PERMISSIONS: readonly PermissionKey[] = [
  "book.delete",
  "user.delete",
  "member.deactivate",
  "registration.review",
  "role.manage",
  "user.manage_staff",
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
  // Deciding whether a child may join the library is not a job for another
  // child, however helpful they are at the desk.
  "registration.review",
  // A child volunteer at the desk must never be able to handle another child's
  // photograph or to assert that an adult has been verified.
  "member.manage_photo",
  "guardian.verify",
  "book.delete",
  "user.delete",
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

/**
 * The name a role has in front of the person who holds it.
 *
 * `SUPER_ADMIN` is a database key. It is what the seed writes, what the
 * permission checks compare, and exactly the wrong thing to print on somebody's
 * own account page — the screen that tells a volunteer what they are should say
 * "Super Admin", not shout an identifier at them.
 *
 * Falls back to the key rather than throwing: an unknown role is a reason to
 * show something plain, never a reason for a person's own page to fail.
 */
export function roleLabel(key: string): string {
  return ROLE_DEFINITIONS.find((role) => role.key === key)?.name ?? key;
}

/** What that role is for, in one sentence. Same fallback rule. */
/**
 * The categories, in the order a person would read them, with the words a
 * volunteer would use rather than the words the database uses.
 *
 * Exists because `/account` used to print raw permission keys — `loan.issue`,
 * `member.deactivate` — in a monospace column on the page a librarian lands on
 * after signing in. That is a debugging view, and it was the first thing a
 * volunteer (or a curious nine-year-old) saw of the software. The keys are
 * still the truth; this is how the truth is said out loud.
 */
export const PERMISSION_CATEGORY_LABELS: Record<string, string> = {
  registrations: "New members",
  members: "Readers and their families",
  catalogue: "The books",
  donations: "Donated books",
  circulation: "Lending and returning",
  operations: "Running the room",
  reports: "Reports",
  administration: "Settings and staff",
};

/**
 * The same permissions, said to the child who holds them.
 *
 * The descriptions in `PERMISSIONS` are written for whoever assigns a role, and
 * that is the wrong voice on a nine-year-old's own page. `loan.view` reads
 * "See loans — your own, or the desk's", which is accurate for a librarian and
 * simply untrue for a reader: they have no desk.
 *
 * A key with no entry here falls back to the staff sentence rather than
 * disappearing. A new member permission then looks slightly formal on a child's
 * screen, which is visible and gets fixed — where a silent omission would leave
 * a page claiming a reader can do less than they can.
 */
const READER_WORDING: Record<string, string> = {
  "book.view": "Look through every book in the library",
  "loan.view": "See the books you have at home and when they are due",
  "loan.request": "Ask a librarian for a book you have found",
  "loan.request_renewal": "Ask to keep a book you are still reading for longer",
  "loan.announce_return": "Tell the library when you are bringing a book back",
  "profile.request_change": "Ask for your own details to be put right",
};

/** One readable sentence for a permission, or null when the key is unknown. */
export function permissionDescription(key: string): string | null {
  const found = (PERMISSIONS as Record<string, { description?: string } | undefined>)[key];
  return found?.description ?? null;
}

/** Which group a permission belongs in, for grouping on screen. */
export function permissionCategory(key: string): string | null {
  const found = (PERMISSIONS as Record<string, { category?: string } | undefined>)[key];
  return found?.category ?? null;
}

/**
 * A person's permissions, grouped and worded for reading.
 *
 * Dormant permissions are dropped rather than labelled "not in use yet". A
 * heading of "What you can do" over a promise the software does not keep is
 * worse than a shorter, true list — and the place to notice a seeded-but-unused
 * key is the audit screen, not the page a volunteer lands on.
 */
export function describeCapabilities(
  permissions: readonly string[],
  voice: "staff" | "reader" = "staff",
): { category: string; label: string; items: string[] }[] {
  const groups = new Map<string, string[]>();

  for (const key of [...permissions].sort()) {
    if (isDormantPermission(key as PermissionKey)) continue;
    const category = permissionCategory(key);
    const description =
      (voice === "reader" ? READER_WORDING[key] : undefined) ?? permissionDescription(key);
    if (!category || !description) continue;
    const bucket = groups.get(category) ?? [];
    bucket.push(description);
    groups.set(category, bucket);
  }

  return Object.keys(PERMISSION_CATEGORY_LABELS)
    .filter((category) => groups.has(category))
    .map((category) => ({
      category,
      label: PERMISSION_CATEGORY_LABELS[category],
      items: groups.get(category) ?? [],
    }));
}

export function roleDescription(key: string): string | null {
  return ROLE_DEFINITIONS.find((role) => role.key === key)?.description ?? null;
}
