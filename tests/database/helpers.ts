import { PrismaClient } from "@prisma/client";

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
      consent_record, registration_request,
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

  return { libraryId: library.id, memberCodePrefix: "TST-R", copyCodePrefix: "TST" };
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
          memberCode: `TST-R${suffix}`,
          dateOfBirth: new Date("2016-01-01"),
          apartment: `A${suffix}`,
        },
      },
      userRoles: { create: { roleId: role.id } },
    },
  });

  return user;
}

let copyCounter = 0;

export async function createBookCopy(libraryId: string) {
  copyCounter += 1;
  const suffix = String(copyCounter).padStart(4, "0");

  const title = await db.bookTitle.create({
    data: { libraryId, title: `Test Book ${suffix}`, authors: ["Test Author"] },
  });

  return db.bookCopy.create({
    data: { libraryId, titleId: title.id, copyCode: `TST-${suffix}` },
  });
}
