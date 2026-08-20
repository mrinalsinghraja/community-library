import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { exportReport } from "@/server/services/report-service";

import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  attachGuardian,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Taking a list out of the library as a file.
 *
 * The feature is small; the thing that has to be held in place is not. An
 * export is a second way to read every list the desk has, so the question these
 * tests answer is whether it is the *same* way — subject to the same
 * permissions, scoped to the same library, redacted in the same places — or a
 * quieter route around them.
 *
 * Two permissions must hold for anything to come out: `report.view`, which says
 * this person may export at all, and whatever the underlying screen already
 * demands. A librarian holds the first and can still not export the audit log,
 * because `listAuditEvents` asks for `audit.view` and does not care that the
 * caller arrived through a report.
 */

let fixture: Fixture;
let admin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** Reads the worksheet out of a generated spreadsheet. */
function sheetXml(bytes: Buffer): string {
  let offset = 0;
  while (offset < bytes.length - 4) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) break;
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const body = inflateRawSync(bytes.subarray(start, start + compressedSize));
    if (name === "xl/worksheets/sheet1.xml") return body.toString("utf8");
    offset = start + compressedSize;
  }
  throw new Error("no worksheet in the package");
}

/** How many data rows the sheet holds, ignoring the header. */
function rowCount(bytes: Buffer): number {
  return (sheetXml(bytes).match(/<row r="\d+"/g)?.length ?? 1) - 1;
}

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  reader = await createMember(fixture.libraryId, { displayName: "Ana Reader" });
  await attachGuardian(fixture.libraryId, reader.id);
  await createBookCopy(fixture.libraryId);
  await createBookCopy(fixture.libraryId);
  __setSessionHandle(null);
});

afterAll(async () => {
  __setSessionHandle(null);
  await db.$disconnect();
});

describe("who may export", () => {
  it("lets a Super Admin export the catalogue", async () => {
    await actingAs(admin.id);

    const file = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [],
      filter: {},
    });

    expect(file.rowCount).toBe(2);
    expect(file.contentType).toContain("spreadsheetml");
  });

  it("lets a Librarian export the catalogue too — this is not an owner-only tool", async () => {
    await actingAs(librarian.id);

    const file = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [],
      filter: {},
    });

    expect(file.rowCount).toBe(2);
  });

  it.each([
    "books",
    "readers",
    "loans",
    "borrow-requests",
    "renewal-requests",
    "registrations",
  ] as const)("lets a Librarian export %s", async (report) => {
    await actingAs(librarian.id);

    await expect(
      exportReport({ report, format: "xlsx", selectedIds: [], filter: {} }),
    ).resolves.toBeTruthy();
  });

  it("refuses a Librarian the audit log, which is not theirs to read", async () => {
    await actingAs(librarian.id);

    await expect(
      exportReport({ report: "audit", format: "xlsx", selectedIds: [], filter: {} }),
    ).rejects.toThrow();
  });

  it("refuses a Librarian the staff list, which needs user.manage_staff", async () => {
    await actingAs(librarian.id);

    await expect(
      exportReport({ report: "staff", format: "xlsx", selectedIds: [], filter: {} }),
    ).rejects.toThrow();
  });

  it("refuses a reader every report, including the catalogue they can browse", async () => {
    await actingAs(reader.id, "MEMBER");

    for (const report of ["books", "readers", "loans", "audit"] as const) {
      await expect(
        exportReport({ report, format: "xlsx", selectedIds: [], filter: {} }),
      ).rejects.toThrow();
    }
  });

  it("refuses a signed-out caller", async () => {
    __setSessionHandle(null);

    await expect(
      exportReport({ report: "books", format: "xlsx", selectedIds: [], filter: {} }),
    ).rejects.toThrow();
  });

  it("refuses anyone whose role has lost report.view, even if they can see the screen", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "LIBRARIAN" } },
    });
    await db.rolePermission.deleteMany({
      where: { roleId: role.id, permissionKey: "report.view" },
    });

    await actingAs(librarian.id);

    await expect(
      exportReport({ report: "books", format: "xlsx", selectedIds: [], filter: {} }),
    ).rejects.toThrow();
  });
});

describe("which rows come out", () => {
  it("exports everything when nothing is ticked", async () => {
    await actingAs(admin.id);

    const file = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [],
      filter: {},
    });

    expect(rowCount(file.bytes)).toBe(2);
  });

  it("exports only the ticked rows", async () => {
    await actingAs(admin.id);
    const copy = await db.bookCopy.findFirstOrThrow({ where: { libraryId: fixture.libraryId } });

    const file = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [copy.id],
      filter: {},
    });

    expect(file.rowCount).toBe(1);
    expect(sheetXml(file.bytes)).toContain(copy.copyCode);
  });

  it("ignores an id that is not in the list, rather than trusting it", async () => {
    await actingAs(admin.id);

    const file = await exportReport({
      report: "books",
      format: "xlsx",
      // A real id shape, belonging to nothing on this screen.
      selectedIds: ["clzzzzzzzzzzzzzzzzzzzzzz"],
      filter: {},
    });

    expect(file.rowCount).toBe(0);
  });

  it("never reaches into another library", async () => {
    /*
     * Built directly rather than through `createLibraryFixture`, which seeds the
     * global permission catalogue and can only run once per database.
     */
    const elsewhere = await db.community.create({
      data: { name: "Elsewhere", slug: `elsewhere-${Date.now()}`, city: "Test City" },
    });
    const theirLibrary = await db.library.create({
      data: {
        communityId: elsewhere.id,
        name: "Elsewhere Library",
        slug: `elsewhere-library-${Date.now()}`,
        settings: { create: { copyCodePrefix: "EL-B", memberCodePrefix: "EL-R" } },
      },
    });
    const theirCategory = await db.bookCategory.create({
      data: { libraryId: theirLibrary.id, name: "Stories", slug: "stories" },
    });
    const theirTitle = await db.bookTitle.create({
      data: {
        libraryId: theirLibrary.id,
        title: "A Book Somewhere Else",
        authors: ["Someone Else"],
        ageGroup: "ALL_AGES",
        categoryId: theirCategory.id,
      },
    });
    const theirCopy = await db.bookCopy.create({
      data: { libraryId: theirLibrary.id, titleId: theirTitle.id, copyCode: "EL-B0001" },
    });

    await actingAs(admin.id);

    const all = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [],
      filter: {},
    });
    const targeted = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [theirCopy.id],
      filter: {},
    });

    expect(sheetXml(all.bytes)).not.toContain(theirCopy.copyCode);
    expect(sheetXml(all.bytes)).not.toContain("A Book Somewhere Else");
    expect(targeted.rowCount).toBe(0);
  });

  it("narrows to the same rows the screen's filter is showing", async () => {
    await actingAs(admin.id);
    const copy = await db.bookCopy.findFirstOrThrow({ where: { libraryId: fixture.libraryId } });
    const title = await db.bookTitle.findUniqueOrThrow({ where: { id: copy.titleId } });

    const file = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [],
      filter: { search: title.title },
    });

    expect(file.rowCount).toBe(1);
  });
});

describe("what the file may contain", () => {
  it("gives a librarian the guardian's contact details they can already see", async () => {
    await actingAs(librarian.id);

    const file = await exportReport({
      report: "readers",
      format: "xlsx",
      selectedIds: [],
      filter: {},
    });

    expect(sheetXml(file.bytes)).toContain("Guardian email");
  });

  it("drops the contact columns entirely for a viewer who may not see them", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "LIBRARIAN" } },
    });
    await db.rolePermission.deleteMany({
      where: { roleId: role.id, permissionKey: "member.view_contact" },
    });
    const guardian = await db.guardian.findFirstOrThrow({
      where: { libraryId: fixture.libraryId },
    });

    await actingAs(librarian.id);
    const file = await exportReport({
      report: "readers",
      format: "xlsx",
      selectedIds: [],
      filter: {},
    });
    const sheet = sheetXml(file.bytes);

    // Not an empty column — no column. An empty one would assert, untruthfully,
    // that these families have no email address.
    expect(sheet).not.toContain("Guardian email");
    expect(sheet).not.toContain("Guardian phone");
    expect(sheet).not.toContain(guardian.email ?? "no-email");
    // The reader is still there; only the contact details are gone.
    expect(sheet).toContain("Ana Reader");
  });

  it("carries no child photograph, storage key or internal id", async () => {
    await actingAs(admin.id);

    const sheet = sheetXml(
      (await exportReport({ report: "readers", format: "xlsx", selectedIds: [], filter: {} })).bytes,
    );

    expect(sheet).not.toContain(reader.id);
    expect(sheet.toLowerCase()).not.toContain("photomediaid");
    expect(sheet.toLowerCase()).not.toContain("avatarkey");
    expect(sheet).not.toContain("/api/media/");
  });

  it("names the file after the library, the report and the day", async () => {
    await actingAs(admin.id);

    const file = await exportReport({
      report: "books",
      format: "xlsx",
      selectedIds: [],
      filter: {},
    });

    expect(file.filename).toMatch(/^[a-z0-9-]+_books_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("produces a PDF for the same list", async () => {
    await actingAs(admin.id);

    const file = await exportReport({
      report: "books",
      format: "pdf",
      selectedIds: [],
      filter: {},
    });

    expect(file.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(file.contentType).toBe("application/pdf");
    expect(file.filename.endsWith(".pdf")).toBe(true);
  });
});

describe("the record it leaves", () => {
  it("writes one audit row for one export", async () => {
    await actingAs(admin.id);
    await exportReport({ report: "readers", format: "xlsx", selectedIds: [], filter: {} });

    const entries = await db.auditLog.findMany({
      where: { libraryId: fixture.libraryId, action: AUDIT_ACTIONS.REPORT_EXPORTED },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].actorUserId).toBe(admin.id);
    expect(entries[0].entityId).toBe("readers");
  });

  it("records what was taken without becoming a second copy of it", async () => {
    await actingAs(admin.id);
    await exportReport({
      report: "readers",
      format: "pdf",
      selectedIds: [reader.id],
      filter: {},
    });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { libraryId: fixture.libraryId, action: AUDIT_ACTIONS.REPORT_EXPORTED },
    });
    const metadata = JSON.stringify(entry.metadata);

    expect(metadata).toContain('"report":"readers"');
    expect(metadata).toContain('"format":"pdf"');
    expect(metadata).toContain('"rowCount":1');
    expect(metadata).toContain('"scope":"selection"');
    // The log says a list of readers left the building. It does not say who
    // was on it, and it does not carry the ids to look them up with.
    expect(metadata).not.toContain(reader.id);
    expect(metadata).not.toContain("Ana Reader");
  });

  it("writes nothing when the export was refused", async () => {
    await actingAs(librarian.id);

    await expect(
      exportReport({ report: "audit", format: "xlsx", selectedIds: [], filter: {} }),
    ).rejects.toThrow();

    const entries = await db.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.REPORT_EXPORTED },
    });
    expect(entries).toHaveLength(0);
  });
});
