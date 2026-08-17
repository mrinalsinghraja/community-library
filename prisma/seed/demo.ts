import { PrismaClient } from "@prisma/client";
import { hash as argon2Hash, type Algorithm } from "@node-rs/argon2";

import { ROLE_KEYS } from "../../src/lib/permissions";
import { CONSENT_TEXT } from "./library-config";

/**
 * DEVELOPMENT AND TEST DATA ONLY.
 *
 * This creates fake people, including a fake child. It must never run against a
 * real library. The guard below is deliberately loud and deliberately not
 * overridable by an environment variable — the only way to seed demo data into
 * production would be to edit this file, which is a decision a reviewer would see.
 */

const DEMO_PASSWORDS = {
  superAdmin: "dev-super-admin-password",
  librarian: "dev-librarian-password",
  member: "readabook",
} as const;

// Argon2id. Written as a literal because the library's enum is an ambient
// `const enum`, which isolatedModules forbids referencing.
const ARGON2ID: Algorithm = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function seedDemo(prisma: PrismaClient, libraryId: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed demo data: NODE_ENV=production. Demo data contains fake children.",
    );
  }

  console.log("\n  ⚠️  DEMO DATA — development only, contains fake accounts\n");

  await seedDemoUsers(prisma, libraryId);
  await seedDemoBooks(prisma, libraryId);

  console.log("\n  Demo sign-ins (development only):");
  console.log(`    Super Admin  admin@example.invalid      / ${DEMO_PASSWORDS.superAdmin}`);
  console.log(`    Librarian    librarian@example.invalid  / ${DEMO_PASSWORDS.librarian}`);
  console.log(`    Reader       MJCL-R0001 or "demoreader" / ${DEMO_PASSWORDS.member}\n`);
}

async function grantRole(
  prisma: PrismaClient,
  libraryId: string,
  userId: string,
  roleKey: string,
): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { libraryId_key: { libraryId, key: roleKey } },
    select: { id: true },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id },
    update: {},
  });
}

async function seedDemoUsers(prisma: PrismaClient, libraryId: string): Promise<void> {
  const settings = await prisma.librarySettings.findUniqueOrThrow({ where: { libraryId } });

  // --- Staff ---------------------------------------------------------------
  const admin = await prisma.appUser.upsert({
    where: { libraryId_email: { libraryId, email: "admin@example.invalid" } },
    create: {
      libraryId,
      kind: "STAFF",
      displayName: "Demo Super Admin",
      email: "admin@example.invalid",
      passwordHash: await argon2Hash(DEMO_PASSWORDS.superAdmin, ARGON2_OPTIONS),
      status: "ACTIVE",
      mustSetPassword: false,
      passwordChangedAt: new Date(),
    },
    update: {},
  });
  await grantRole(prisma, libraryId, admin.id, ROLE_KEYS.SUPER_ADMIN);

  const librarian = await prisma.appUser.upsert({
    where: { libraryId_email: { libraryId, email: "librarian@example.invalid" } },
    create: {
      libraryId,
      kind: "STAFF",
      displayName: "Demo Librarian",
      email: "librarian@example.invalid",
      passwordHash: await argon2Hash(DEMO_PASSWORDS.librarian, ARGON2_OPTIONS),
      status: "ACTIVE",
      mustSetPassword: false,
      passwordChangedAt: new Date(),
    },
    update: {},
  });
  await grantRole(prisma, libraryId, librarian.id, ROLE_KEYS.LIBRARIAN);

  // --- A fake child, with a fake guardian and a real consent record ---------
  const existingMember = await prisma.appUser.findFirst({
    where: { libraryId, username: "demoreader" },
    select: { id: true },
  });

  if (!existingMember) {
    const member = await prisma.appUser.create({
      data: {
        libraryId,
        kind: "MEMBER",
        displayName: "Demo Reader",
        username: "demoreader",
        passwordHash: await argon2Hash(DEMO_PASSWORDS.member, ARGON2_OPTIONS),
        status: "ACTIVE",
        mustSetPassword: false,
        passwordChangedAt: new Date(),
        memberProfile: {
          create: {
            libraryId,
            memberCode: `${settings.memberCodePrefix}${"1".padStart(settings.memberCodePadding, "0")}`,
            dateOfBirth: new Date("2016-04-12"),
            apartment: "A101",
            avatarKey: "fox",
          },
        },
      },
    });
    await grantRole(prisma, libraryId, member.id, ROLE_KEYS.MEMBER);

    // Burn the first member code so the allocator does not reissue it.
    await prisma.codeSequence.update({
      where: { libraryId_kind: { libraryId, kind: "MEMBER" } },
      data: { nextValue: 2 },
    });

    const guardian = await prisma.guardian.upsert({
      where: { libraryId_email: { libraryId, email: "guardian@example.invalid" } },
      create: {
        libraryId,
        fullName: "Demo Guardian",
        email: "guardian@example.invalid",
        phone: "+91 90000 00000",
        apartment: "A101",
      },
      update: {},
    });

    await prisma.guardianMember.upsert({
      where: { guardianId_memberUserId: { guardianId: guardian.id, memberUserId: member.id } },
      create: { guardianId: guardian.id, memberUserId: member.id, isPrimary: true },
      update: {},
    });

    // Consent is modelled properly even in demo data, so the shape gets exercised.
    await prisma.consentRecord.create({
      data: {
        libraryId,
        type: "CHILD_ACCOUNT_CREATION",
        status: "GRANTED",
        method: "WEB_FORM",
        consentVersion: settings.consentVersion,
        consentTextSnapshot: CONSENT_TEXT.CHILD_ACCOUNT_CREATION,
        guardianId: guardian.id,
        memberUserId: member.id,
      },
    });

    /*
     * And the separate question of who that guardian was.
     *
     * Recorded as SELF_DECLARED, which is what a ticked box is worth and no
     * more. Demo data that overstated its own verification would be the worst
     * possible example to copy.
     */
    await prisma.guardianVerification.create({
      data: {
        libraryId,
        method: "SELF_DECLARED",
        status: "VERIFIED",
        strength: "SELF_DECLARED",
        verificationVersion: settings.guardianVerificationVersion,
        verifiedAt: new Date(),
        guardianId: guardian.id,
        memberUserId: member.id,
      },
    });
  }

  console.log(
    "  ✓ demo users (1 super admin, 1 librarian, 1 reader + guardian + consent + verification)",
  );
}

const DEMO_BOOKS = [
  { title: "The Gruffalo", authors: ["Julia Donaldson"], category: "picture-books", ageMin: 3, ageMax: 7, copies: 2 },
  { title: "Matilda", authors: ["Roald Dahl"], category: "story-books", ageMin: 8, ageMax: 12, copies: 1 },
  { title: "Charlotte's Web", authors: ["E. B. White"], category: "animals", ageMin: 7, ageMax: 11, copies: 1 },
  { title: "The Magic Faraway Tree", authors: ["Enid Blyton"], category: "fantasy", ageMin: 6, ageMax: 10, copies: 1 },
  { title: "A Wrinkle in Time", authors: ["Madeleine L'Engle"], category: "space", ageMin: 10, ageMax: 14, copies: 1 },
  { title: "The Story of Babur", authors: ["Anuradha Sharma"], category: "history", ageMin: 9, ageMax: 14, copies: 1 },
] as const;

const DEMO_DONORS = [
  { name: "Mrinal", apartment: "P15", consent: "NAMED" as const },
  { name: "The Iyer family", apartment: "B204", consent: "APARTMENT_ONLY" as const },
  { name: "A neighbour", apartment: "C007", consent: "ANONYMOUS" as const },
];

async function seedDemoBooks(prisma: PrismaClient, libraryId: string): Promise<void> {
  const settings = await prisma.librarySettings.findUniqueOrThrow({ where: { libraryId } });
  let sequence = (
    await prisma.codeSequence.findUniqueOrThrow({
      where: { libraryId_kind: { libraryId, kind: "BOOK_COPY" } },
    })
  ).nextValue;

  let donorIndex = 0;

  for (const book of DEMO_BOOKS) {
    const existing = await prisma.bookTitle.findFirst({
      where: { libraryId, title: book.title },
      select: { id: true },
    });
    if (existing) continue;

    const category = await prisma.bookCategory.findUnique({
      where: { libraryId_slug: { libraryId, slug: book.category } },
      select: { id: true },
    });

    const title = await prisma.bookTitle.create({
      data: {
        libraryId,
        title: book.title,
        authors: [...book.authors],
        categoryId: category?.id ?? null,
        ageMin: book.ageMin,
        ageMax: book.ageMax,
        language: "English",
      },
    });

    for (let copyIndex = 0; copyIndex < book.copies; copyIndex += 1) {
      const donor = DEMO_DONORS[donorIndex % DEMO_DONORS.length];
      donorIndex += 1;

      const copy = await prisma.bookCopy.create({
        data: {
          libraryId,
          titleId: title.id,
          copyCode: `${settings.copyCodePrefix}-${String(sequence).padStart(settings.copyCodePadding, "0")}`,
          status: "AVAILABLE",
          condition: "GOOD",
          acquisitionType: "RESIDENT_DONATION",
          shelfLocation: "Yoga Room — shelf 1",
        },
      });
      sequence += 1;

      await prisma.donation.create({
        data: {
          libraryId,
          copyId: copy.id,
          donorName: donor.name,
          donorApartment: donor.apartment,
          displayConsent: donor.consent,
        },
      });
    }
  }

  await prisma.codeSequence.update({
    where: { libraryId_kind: { libraryId, kind: "BOOK_COPY" } },
    data: { nextValue: sequence },
  });

  console.log(`  ✓ demo catalogue (${DEMO_BOOKS.length} titles, ${sequence - 1} copies with donors)`);
}
