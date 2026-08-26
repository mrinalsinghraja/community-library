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
    await backfillVenueCopy(prisma, existing.id, config);
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
 * Fills in venue copy that has never been set, and nothing else.
 *
 * The rest of this function deliberately leaves an existing library's settings
 * alone: re-running the seed must not undo what an administrator has since
 * changed. These three columns are the one case where that rule does not apply,
 * because they did not exist until the migration that added them — a NULL here
 * is not a choice somebody made, it is a column that arrived empty.
 *
 * So the test is "has anybody ever set this", not "does it differ from the
 * config". Once a Super Admin has typed a room name on the branding screen this
 * does nothing, for ever.
 */
async function backfillVenueCopy(
  prisma: PrismaClient,
  libraryId: string,
  config: LibraryConfigInput,
): Promise<void> {
  const settings = await prisma.librarySettings.findUnique({
    where: { libraryId },
    select: { venueName: true, venueAddress: true, eligibilityNote: true },
  });
  if (!settings) return;

  const data: {
    venueName?: string;
    venueAddress?: string;
    eligibilityNote?: string;
  } = {};

  // The platform default, which means nobody has named the room yet. A library
  // that has genuinely chosen to call its room "the library room" writes the
  // same string, and this changes nothing for them either.
  if (settings.venueName === PLATFORM_DEFAULT_VENUE_NAME) data.venueName = config.settings.venueName;
  if (settings.venueAddress === null) data.venueAddress = config.settings.venueAddress;
  if (settings.eligibilityNote === null) data.eligibilityNote = config.settings.eligibilityNote;

  if (Object.keys(data).length === 0) return;

  await prisma.librarySettings.update({ where: { libraryId }, data });
  console.log(`  ✓ filled in ${Object.keys(data).join(", ")} (never set before)`);
}

/** Must match the column default in schema.prisma. */
const PLATFORM_DEFAULT_VENUE_NAME = "library room";

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

/**
 * Book categories, reconciled against the configured list.
 *
 * Phase 0 seeded fourteen; Version 1 of the catalogue narrows that to seven.
 * Reconciling rather than only inserting is what makes that narrowing actually
 * happen on an existing database.
 *
 * Retirement is careful, in this order:
 *
 *   * a category with books on its shelf is never touched — the `onDelete:
 *     Restrict` on `book_title.category_id` agrees, and would refuse anyway;
 *   * a category with no books is deleted, because an empty shelf label nobody
 *     chose is clutter rather than history;
 *   * anything an administrator added by hand is left alone — only slugs this
 *     seed originally created are candidates.
 *
 * Categories an administrator adds later are not in `config.categories`, so
 * the last rule matters: without it, `npm run db:seed` would quietly delete
 * their work.
 */
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
      update: { name: category.name, icon: category.icon, sortOrder: (index + 1) * 10 },
    });
  }

  const keep = new Set(config.categories.map((category) => category.slug));
  const retired = await prisma.bookCategory.findMany({
    where: {
      libraryId,
      slug: { in: [...RETIRABLE_SEED_CATEGORY_SLUGS].filter((slug) => !keep.has(slug)) },
    },
    select: { id: true, name: true, _count: { select: { bookTitles: true } } },
  });

  for (const category of retired) {
    if (category._count.bookTitles > 0) {
      console.log(
        `  • category "${category.name}" has books on its shelf — left in place`,
      );
      continue;
    }
    await prisma.bookCategory.delete({ where: { id: category.id } });
  }

  console.log(`  ✓ ${config.categories.length} book categories`);
}

/**
 * Slugs earlier seeds created, and which this seed may therefore remove again.
 *
 * An explicit list rather than "anything not in the config": that would delete
 * every category an administrator has added since, which is precisely the
 * flexibility `book_category` exists to provide.
 */
const RETIRABLE_SEED_CATEGORY_SLUGS: readonly string[] = [
  "story-books",
  "picture-books",
  "adventure",
  "fantasy",
  "animals",
  "space",
  "science",
  "general-knowledge",
  "history",
  "biography",
  "educational",
  "activity-books",
];

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
