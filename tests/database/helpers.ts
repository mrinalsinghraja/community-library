import { PrismaClient } from "@prisma/client";

import { DEFAULT_CATEGORIES } from "../../src/lib/catalogue";
import { ROLE_DEFINITIONS } from "../../src/lib/permissions";
import { PERMISSIONS } from "../../src/lib/permissions";

export const db = new PrismaClient();

/**
 * Wipes every table. Order matters only where onDelete is Restrict, so this
 * deletes children before parents.
 */
export async function resetDatabase(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_log, email_event, announcement, login_attempt,
      auth_token, "session", media_object,
      renewal_request, loan_event, loan,
      donation, book_copy, book_title, book_category,
      guardian_verification, consent_record, registration_request,
      guardian_member, guardian, member_profile,
      user_role, role_permission, "role", app_user,
      code_sequence, library_settings, library, community, permission
    RESTART IDENTITY CASCADE
  `);
}

export interface Fixture {
  libraryId: string;
  memberCodePrefix: string;
  copyCodePrefix: string;
}

/**
 * A minimal but realistic library: community, library, settings, permissions,
 * roles and code sequences. Uses neutral names — the fixtures deliberately do
 * not mention any real community.
 */
export async function createLibraryFixture(): Promise<Fixture> {
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await db.permission.create({
      data: { key, category: meta.category, description: meta.description },
    });
  }

  const community = await db.community.create({
    data: { name: "Test Community", slug: "test-community", city: "Test City" },
  });

  const library = await db.library.create({
    data: {
      communityId: community.id,
      name: "Test Children's Library",
      slug: "test-childrens-library",
      settings: {
        create: {
          copyCodePrefix: "TST",
          memberCodePrefix: "TST-R",
          borrowingPeriodDays: 14,
          maxActiveLoans: 2,
          maxRenewals: 1,
        },
      },
    },
  });

  for (const definition of ROLE_DEFINITIONS) {
    const role = await db.role.create({
      data: {
        libraryId: library.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isAssignable: definition.isAssignable,
        sortOrder: definition.sortOrder,
      },
    });
    for (const permissionKey of definition.permissions) {
      await db.rolePermission.create({ data: { roleId: role.id, permissionKey } });
    }
  }

  for (const kind of ["BOOK_COPY", "MEMBER"]) {
    await db.codeSequence.create({ data: { libraryId: library.id, kind, nextValue: 1 } });
  }

  // The same seven shelves the real seed creates. Every book_title needs one,
  // so a fixture without them describes a library that could not exist.
  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    await db.bookCategory.create({
      data: {
        libraryId: library.id,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        sortOrder: (index + 1) * 10,
      },
    });
  }

  return { libraryId: library.id, memberCodePrefix: "TST-R", copyCodePrefix: "TST" };
}

/** The library's "Stories" shelf, which every fixture book is filed on. */
export async function defaultCategory(libraryId: string) {
  return db.bookCategory.findUniqueOrThrow({
    where: { libraryId_slug: { libraryId, slug: "stories" } },
  });
}

let memberCounter = 0;

export async function createMember(
  libraryId: string,
  overrides: { displayName?: string; username?: string; status?: "ACTIVE" | "SUSPENDED" } = {},
) {
  memberCounter += 1;
  const suffix = String(memberCounter).padStart(4, "0");

  const role = await db.role.findUniqueOrThrow({
    where: { libraryId_key: { libraryId, key: "MEMBER" } },
  });

  const user = await db.appUser.create({
    data: {
      libraryId,
      kind: "MEMBER",
      displayName: overrides.displayName ?? `Test Reader ${suffix}`,
      username: overrides.username ?? `reader${suffix}`,
      status: overrides.status ?? "ACTIVE",
      mustSetPassword: false,
      passwordHash: "$argon2id$placeholder",
      memberProfile: {
        create: {
          libraryId,
          // "H" for helper: fixture members must not collide with the codes
          // the real allocator issues during approval tests.
          memberCode: `TST-H${suffix}`,
          dateOfBirth: new Date("2016-01-01"),
          apartment: `A${suffix}`,
        },
      },
      userRoles: { create: { roleId: role.id } },
    },
  });

  /*
   * Every member created through the real workflow carries a guardian
   * verification record, because approval cannot happen without one. Fixtures
   * must carry it too — otherwise they describe a member who could never have
   * existed, and the activation gate rightly refuses them.
   *
   * A member with NO record at all resolves to strength NONE, which fails every
   * requirement above NONE. That is deliberate: absence of evidence is the
   * weakest possible state, not an exemption. See the explicit test for it in
   * activation-and-reset.test.ts.
   */
  await db.guardianVerification.create({
    data: {
      libraryId,
      memberUserId: user.id,
      method: "SELF_DECLARED",
      status: "VERIFIED",
      strength: "SELF_DECLARED",
      verificationVersion: "test",
      verifiedAt: new Date(),
    },
  });

  return user;
}

let staffCounter = 0;

/** A staff account with a single role, for authorization tests. */
export async function createStaff(
  libraryId: string,
  roleKey: "LIBRARIAN" | "SUPER_ADMIN",
  overrides: { displayName?: string; status?: "ACTIVE" | "SUSPENDED" } = {},
) {
  staffCounter += 1;

  const role = await db.role.findUniqueOrThrow({
    where: { libraryId_key: { libraryId, key: roleKey } },
  });

  return db.appUser.create({
    data: {
      libraryId,
      kind: "STAFF",
      displayName: overrides.displayName ?? `Test ${roleKey} ${staffCounter}`,
      email: `staff${staffCounter}@example.invalid`,
      status: overrides.status ?? "ACTIVE",
      mustSetPassword: false,
      passwordHash: "$argon2id$placeholder",
      passwordChangedAt: new Date(),
      userRoles: { create: { roleId: role.id } },
    },
  });
}

/** A guardian linked to a member, so recovery-channel tests have a real target. */
export async function attachGuardian(
  libraryId: string,
  memberUserId: string,
  email = `guardian${Math.random().toString(36).slice(2, 10)}@example.invalid`,
) {
  const guardian = await db.guardian.create({
    data: {
      libraryId,
      fullName: "Test Guardian",
      email,
      phone: "+910000000000",
      apartment: "Z9",
    },
  });

  await db.guardianMember.create({
    data: { guardianId: guardian.id, memberUserId, isPrimary: true },
  });

  return guardian;
}

let copyCounter = 0;

export async function createBookCopy(libraryId: string) {
  copyCounter += 1;
  const suffix = String(copyCounter).padStart(4, "0");

  const category = await defaultCategory(libraryId);

  const title = await db.bookTitle.create({
    data: {
      libraryId,
      title: `Test Book ${suffix}`,
      authors: ["Test Author"],
      ageGroup: "ALL_AGES",
      categoryId: category.id,
    },
  });

  return db.bookCopy.create({
    data: { libraryId, titleId: title.id, copyCode: `TST-${suffix}` },
  });
}
