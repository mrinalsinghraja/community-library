import { PrismaClient } from "@prisma/client";

import { ROLE_DEFINITIONS } from "../../src/lib/permissions";
import { MANA_JARDIN, type LibraryConfigInput } from "./library-config";

/**
 * Library seed — creates one community, its library, its settings, its roles
 * and its categories.
 *
 * Safe to run in production: it creates configuration, never people. Idempotent
 * on the library slug, so re-running does not duplicate anything and does not
 * overwrite settings an administrator has since changed.
 */
export async function seedLibrary(
  prisma: PrismaClient,
  config: LibraryConfigInput = MANA_JARDIN,
): Promise<{ libraryId: string }> {
  const existing = await prisma.library.findUnique({
    where: { slug: config.library.slug },
    select: { id: true },
  });

  if (existing) {
    console.log(`  • library "${config.library.slug}" already exists — leaving its settings alone`);
    await seedRoles(prisma, existing.id);
    await seedCategories(prisma, existing.id, config);
    await seedCodeSequences(prisma, existing.id);
    return { libraryId: existing.id };
  }

  const community = await prisma.community.upsert({
    where: { slug: config.community.slug },
    create: {
      name: config.community.name,
      slug: config.community.slug,
      city: config.community.city,
      addressLine: config.community.addressLine,
    },
    update: {},
  });

  const library = await prisma.library.create({
    data: {
      communityId: community.id,
      name: config.library.name,
      slug: config.library.slug,
      description: config.library.description,
      settings: { create: { ...config.settings } },
    },
  });

  console.log(`  ✓ community "${community.name}" and library "${library.name}"`);

  await seedRoles(prisma, library.id);
  await seedCategories(prisma, library.id, config);
  await seedCodeSequences(prisma, library.id);

  return { libraryId: library.id };
}

/**
 * Roles and their permission grants.
 *
 * Grants are reconciled on every run: a permission added to a role definition
 * appears, and one removed is revoked. That keeps the database honest against
 * the source of truth in src/lib/permissions.ts.
 */
async function seedRoles(prisma: PrismaClient, libraryId: string): Promise<void> {
  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { libraryId_key: { libraryId, key: definition.key } },
      create: {
        libraryId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        isAssignable: definition.isAssignable,
        sortOrder: definition.sortOrder,
      },
      update: {
        name: definition.name,
        description: definition.description,
        isAssignable: definition.isAssignable,
        sortOrder: definition.sortOrder,
      },
    });

    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionKey: { notIn: [...definition.permissions] } },
    });

    for (const permissionKey of definition.permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId: role.id, permissionKey } },
        create: { roleId: role.id, permissionKey },
        update: {},
      });
    }
  }

  console.log(
    `  ✓ ${ROLE_DEFINITIONS.length} roles (JUNIOR_LIBRARIAN seeded but not assignable)`,
  );
}

async function seedCategories(
  prisma: PrismaClient,
  libraryId: string,
  config: LibraryConfigInput,
): Promise<void> {
  for (const [index, category] of config.categories.entries()) {
    await prisma.bookCategory.upsert({
      where: { libraryId_slug: { libraryId, slug: category.slug } },
      create: {
        libraryId,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        sortOrder: (index + 1) * 10,
      },
      update: { name: category.name, icon: category.icon },
    });
  }

  console.log(`  ✓ ${config.categories.length} book categories`);
}

/** One allocator row per kind of code. Without these, nothing can be catalogued. */
async function seedCodeSequences(prisma: PrismaClient, libraryId: string): Promise<void> {
  for (const kind of ["BOOK_COPY", "MEMBER"]) {
    await prisma.codeSequence.upsert({
      where: { libraryId_kind: { libraryId, kind } },
      create: { libraryId, kind, nextValue: 1 },
      update: {},
    });
  }

  console.log("  ✓ code sequences (book copies, member cards)");
}
