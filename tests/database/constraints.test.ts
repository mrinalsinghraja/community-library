import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  db,
  defaultCategory,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * These tests exist to prove that the *database* enforces our promises — not
 * the application, not the UI. Every one of them would still pass if the
 * service layer were deleted, which is the point: the database is the last line
 * of defence when application code is wrong or raced.
 */

let fixture: Fixture;

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
});

afterAll(async () => {
  await db.$disconnect();
});

/**
 * A physical book cannot be in two pairs of hands.
 *
 * Two mechanisms hold this, and both are tested here without the service layer:
 * the partial unique index `one_active_loan_per_copy`, and the deferred
 * constraint trigger that ties a copy's status to whether it has a loan at all.
 *
 * Note the `issueByHand` helper. Since Phase 3 a loan row on its own is not a
 * legal state — the copy has to read BORROWED in the same transaction — so
 * these tests build a coherent loan and then attack it, rather than testing the
 * index against a state the database would never have allowed to exist.
 */
describe("one active loan per physical copy", () => {
  /** A loan and its copy status, committed together, exactly as issuing does. */
  async function issueByHand(copyId: string, memberUserId: string) {
    return db.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          libraryId: fixture.libraryId,
          copyId,
          memberUserId,
          dueAt: new Date(Date.now() + 14 * 86_400_000),
        },
      });
      await tx.bookCopy.update({ where: { id: copyId }, data: { status: "BORROWED" } });
      return loan;
    });
  }

  it("refuses a second active loan on the same copy", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const [readerA, readerB] = await Promise.all([
      createMember(fixture.libraryId),
      createMember(fixture.libraryId),
    ]);

    await issueByHand(copy.id, readerA.id);

    // Two children cannot have the same physical book. Disabling a button in
    // the browser is not what stops this.
    await expect(issueByHand(copy.id, readerB.id)).rejects.toThrow(
      /one_active_loan_per_copy|unique|active loans/i,
    );
  });

  it("survives two simultaneous issues — exactly one wins", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const [readerA, readerB] = await Promise.all([
      createMember(fixture.libraryId),
      createMember(fixture.libraryId),
    ]);

    const results = await Promise.allSettled([
      issueByHand(copy.id, readerA.id),
      issueByHand(copy.id, readerB.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const activeLoans = await db.loan.count({ where: { copyId: copy.id, status: "ACTIVE" } });
    expect(activeLoans).toBe(1);
  });

  it("allows the copy to be borrowed again once it has come back", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const readerA = await createMember(fixture.libraryId);
    const readerB = await createMember(fixture.libraryId);

    const first = await issueByHand(copy.id, readerA.id);

    await db.$transaction(async (tx) => {
      await tx.loan.update({
        where: { id: first.id },
        data: { status: "RETURNED", returnedAt: new Date() },
      });
      await tx.bookCopy.update({ where: { id: copy.id }, data: { status: "AVAILABLE" } });
    });

    // The index is partial (WHERE status = 'ACTIVE'), so history does not block
    // the next reader.
    await expect(issueByHand(copy.id, readerB.id)).resolves.toBeDefined();
  });

  it("refuses a copy that claims to be borrowed with nobody holding it", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    // The cross-table half of the invariant, which no CHECK constraint could
    // express: a status and a loan that disagree cannot be committed.
    await expect(
      db.bookCopy.update({ where: { id: copy.id }, data: { status: "BORROWED" } }),
    ).rejects.toThrow(/must have a borrower/);
  });
});

describe("unique identifiers", () => {
  it("refuses a duplicate book copy code within a library", async () => {
    const category = await defaultCategory(fixture.libraryId);
    const title = await db.bookTitle.create({
      data: {
        libraryId: fixture.libraryId,
        title: "Duplicate Code Test",
        authors: ["A"],
        ageGroup: "ALL_AGES",
        categoryId: category.id,
      },
    });

    await db.bookCopy.create({
      data: { libraryId: fixture.libraryId, titleId: title.id, copyCode: "TST-9001" },
    });

    await expect(
      db.bookCopy.create({
        data: { libraryId: fixture.libraryId, titleId: title.id, copyCode: "TST-9001" },
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("refuses a duplicate member card code", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "MEMBER" } },
    });

    const makeMember = (username: string) =>
      db.appUser.create({
        data: {
          libraryId: fixture.libraryId,
          kind: "MEMBER" as const,
          displayName: "Card Clash",
          username,
          status: "ACTIVE" as const,
          memberProfile: {
            create: {
              libraryId: fixture.libraryId,
              memberCode: "TST-R9999",
              birthYear: 2016,
              apartment: "Z1",
            },
          },
          userRoles: { create: { roleId: role.id } },
        },
      });

    await makeMember("cardclash1");
    await expect(makeMember("cardclash2")).rejects.toThrow(/unique/i);
  });

  it("refuses two open registrations for the same child in the same flat", async () => {
    const base = {
      libraryId: fixture.libraryId,
      childBirthYear: 2017,
      guardianName: "A Guardian",
      guardianEmail: "guardian@example.invalid",
      guardianPhone: "+910000000000",
    };

    await db.registrationRequest.create({
      data: { ...base, childName: "Aarav", apartment: "P15" },
    });

    // Case and stray whitespace must not defeat the guard.
    await expect(
      db.registrationRequest.create({
        data: { ...base, childName: "  aarav ", apartment: "p15" },
      }),
    ).rejects.toThrow(/unique|one_open_registration_per_child/i);
  });

  it("lets the same child register again once the first request is resolved", async () => {
    const base = {
      libraryId: fixture.libraryId,
      childBirthYear: 2017,
      guardianName: "A Guardian",
      guardianEmail: "guardian2@example.invalid",
      guardianPhone: "+910000000000",
    };

    const first = await db.registrationRequest.create({
      data: { ...base, childName: "Meera", apartment: "Q22" },
    });
    await db.registrationRequest.update({
      where: { id: first.id },
      data: { status: "REJECTED", reviewedAt: new Date() },
    });

    await expect(
      db.registrationRequest.create({ data: { ...base, childName: "Meera", apartment: "Q22" } }),
    ).resolves.toBeDefined();
  });
});

describe("login identifiers are stored normalised", () => {
  it("refuses an email that is not already lowercased", async () => {
    await expect(
      db.appUser.create({
        data: {
          libraryId: fixture.libraryId,
          kind: "STAFF",
          displayName: "Mixed Case",
          email: "Librarian@Example.Invalid",
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow(/app_user_email_is_normalised|constraint/i);
  });

  it("refuses a username with characters that would confuse a child", async () => {
    await expect(
      db.appUser.create({
        data: {
          libraryId: fixture.libraryId,
          kind: "MEMBER",
          displayName: "Odd Name",
          username: "Aarav Kumar!",
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow(/constraint/i);
  });
});

describe("configuration cannot be saved in a broken state", () => {
  it("refuses an age range that makes no sense", async () => {
    await expect(
      db.librarySettings.update({
        where: { libraryId: fixture.libraryId },
        data: { ageMin: 14, ageMax: 5 },
      }),
    ).rejects.toThrow(/sane_age_range|constraint/i);
  });

  it("refuses a zero-day borrowing period", async () => {
    await expect(
      db.librarySettings.update({
        where: { libraryId: fixture.libraryId },
        data: { borrowingPeriodDays: 0 },
      }),
    ).rejects.toThrow(/borrowing_period|constraint/i);
  });

  it("refuses a branding colour that is not real hex", async () => {
    // A bad colour here would break every page in the application.
    await expect(
      db.librarySettings.update({
        where: { libraryId: fixture.libraryId },
        data: { primaryColor: "not-a-colour" },
      }),
    ).rejects.toThrow(/colour_format|constraint/i);
  });

  it("refuses an empty code prefix", async () => {
    await expect(
      db.librarySettings.update({
        where: { libraryId: fixture.libraryId },
        data: { copyCodePrefix: "   " },
      }),
    ).rejects.toThrow(/prefixes_present|constraint/i);
  });

  it("still accepts a valid change", async () => {
    const updated = await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { borrowingPeriodDays: 21, primaryColor: "#123456" },
    });

    expect(updated.borrowingPeriodDays).toBe(21);

    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { borrowingPeriodDays: 14, primaryColor: "#1F6F5C" },
    });
  });
});

describe("loans must be coherent in time", () => {
  it("refuses a due date before the issue date", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const reader = await createMember(fixture.libraryId);

    await expect(
      db.loan.create({
        data: {
          libraryId: fixture.libraryId,
          copyId: copy.id,
          memberUserId: reader.id,
          issuedAt: new Date("2026-08-17T10:00:00Z"),
          dueAt: new Date("2026-08-10T10:00:00Z"),
        },
      }),
    ).rejects.toThrow(/due_after_issue|constraint/i);
  });

  it("refuses an active loan that claims to have been returned", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const reader = await createMember(fixture.libraryId);

    await expect(
      db.loan.create({
        data: {
          libraryId: fixture.libraryId,
          copyId: copy.id,
          memberUserId: reader.id,
          dueAt: new Date(Date.now() + 86_400_000),
          status: "ACTIVE",
          returnedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/return_fields_match_status|constraint/i);
  });
});

describe("consent is evidence, not a boolean", () => {
  it("refuses a withdrawal with no withdrawal timestamp", async () => {
    const member = await createMember(fixture.libraryId);

    await expect(
      db.consentRecord.create({
        data: {
          libraryId: fixture.libraryId,
          type: "CHILD_ACCOUNT_CREATION",
          status: "WITHDRAWN",
          consentVersion: "2026-08-v1",
          consentTextSnapshot: "I agree…",
          memberUserId: member.id,
        },
      }),
    ).rejects.toThrow(/withdrawal_has_timestamp|constraint/i);
  });

  it("refuses consent with no wording recorded", async () => {
    const member = await createMember(fixture.libraryId);

    await expect(
      db.consentRecord.create({
        data: {
          libraryId: fixture.libraryId,
          type: "CHILD_ACCOUNT_CREATION",
          consentVersion: "2026-08-v1",
          consentTextSnapshot: "   ",
          memberUserId: member.id,
        },
      }),
    ).rejects.toThrow(/text_snapshot_present|constraint/i);
  });

  it("refuses consent that is not attached to anybody", async () => {
    await expect(
      db.consentRecord.create({
        data: {
          libraryId: fixture.libraryId,
          type: "CHILD_ACCOUNT_CREATION",
          consentVersion: "2026-08-v1",
          consentTextSnapshot: "I agree…",
        },
      }),
    ).rejects.toThrow(/consent_has_subject|constraint/i);
  });
});

describe("donor credit", () => {
  it("refuses a named credit with no name to show", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    await expect(
      db.donation.create({
        data: {
          libraryId: fixture.libraryId,
          copyId: copy.id,
          donorName: "  ",
          displayConsent: "NAMED",
        },
      }),
    ).rejects.toThrow(/named_credit_has_name|constraint/i);
  });

  it("refuses an apartment-only credit with no apartment", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    await expect(
      db.donation.create({
        data: {
          libraryId: fixture.libraryId,
          copyId: copy.id,
          donorName: "Someone",
          displayConsent: "APARTMENT_ONLY",
          donorApartment: null,
        },
      }),
    ).rejects.toThrow(/apartment_credit_has_apartment|constraint/i);
  });

  it("accepts an anonymous credit with no identifying detail at all", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    await expect(
      db.donation.create({
        data: {
          libraryId: fixture.libraryId,
          copyId: copy.id,
          donorName: "A neighbour",
          displayConsent: "ANONYMOUS",
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("private media", () => {
  it("refuses to give a private object a public URL", async () => {
    // A child's photograph must not be reachable by URL alone.
    await expect(
      db.mediaObject.create({
        data: {
          libraryId: fixture.libraryId,
          visibility: "PRIVATE",
          storageKey: "child_photo/2026/8/abc.jpg",
          publicUrl: "https://example.invalid/abc.jpg",
          mimeType: "image/jpeg",
          byteSize: 1024,
          checksumSha256: "a".repeat(64),
          purpose: "child_photo",
        },
      }),
    ).rejects.toThrow(/private_has_no_public_url|constraint/i);
  });
});
