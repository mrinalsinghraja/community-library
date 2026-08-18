import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { AUDIT_PAGE_SIZE, listAuditEvents } from "@/server/services/audit-service";
import { updateLibrarySettings } from "@/server/services/settings-service";

import {
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Reading the log.
 *
 * The log itself has been written since Phase 0; what is new is a screen. The
 * properties that matter are therefore about reading:
 *
 *   1. Only `audit.view` — which in this version means the Super Admin alone.
 *   2. One library. A log is not somewhere tenancy may be relaxed.
 *   3. Configuration details are shown; everything else's metadata is not. A
 *      screen for operations must not become a place to read about children.
 *   4. Nothing on the read path can write. There is no update or delete in the
 *      service, and this file proves the rows survive a read unchanged.
 */

let fixture: Fixture;
let admin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** Writes an audit row directly, standing in for whichever service made it. */
async function log(params: {
  action: string;
  actorLabel?: string;
  entityType?: string;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
  libraryId?: string;
}) {
  return db.auditLog.create({
    data: {
      libraryId: params.libraryId ?? fixture.libraryId,
      action: params.action,
      entityType: params.entityType ?? "loan",
      actorLabel: params.actorLabel ?? "Someone",
      metadata: params.metadata,
      ...(params.occurredAt ? { occurredAt: params.occurredAt } : {}),
    },
  });
}

const VALID_SETTINGS = {
  libraryName: "Test Children's Library",
  timezone: "Asia/Kolkata",
  dateFormat: "d MMM yyyy",
  borrowingPeriodDays: "14",
  maxActiveLoans: "2",
  maxRenewals: "1",
  renewalPeriodDays: "14",
  ageMin: "5",
  ageMax: "14",
  memberCodePrefix: "TST-R",
  copyCodePrefix: "TST-B",
  catalogueVisibility: "MEMBER_ONLY",
};

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  reader = await createMember(fixture.libraryId);
  __setSessionHandle(null);
});

describe("who may read the log", () => {
  it("lets a Super Admin read it", async () => {
    await log({ action: AUDIT_ACTIONS.LOAN_ISSUED });
    await actingAs(admin.id);

    const page = await listAuditEvents();
    expect(page.total).toBe(1);
  });

  it("refuses a librarian, a child and a signed-out request", async () => {
    await log({ action: AUDIT_ACTIONS.LOAN_ISSUED });

    await actingAs(librarian.id);
    await expect(listAuditEvents()).rejects.toThrow();

    await actingAs(reader.id, "MEMBER");
    await expect(listAuditEvents()).rejects.toThrow();

    __setSessionHandle(null);
    await expect(listAuditEvents()).rejects.toThrow();
  });

  it("never shows another library's log", async () => {
    const otherCommunity = await db.community.create({
      data: { name: "Other Community", slug: "other-community", city: "Elsewhere" },
    });
    const otherLibrary = await db.library.create({
      data: {
        communityId: otherCommunity.id,
        name: "Other Library",
        slug: "other-library",
        settings: { create: {} },
      },
    });

    await log({ action: AUDIT_ACTIONS.LOAN_ISSUED, actorLabel: "Ours" });
    await log({
      action: AUDIT_ACTIONS.LOAN_ISSUED,
      actorLabel: "Theirs",
      libraryId: otherLibrary.id,
    });

    await actingAs(admin.id);
    const page = await listAuditEvents();

    expect(page.total).toBe(1);
    expect(page.entries[0].actorLabel).toBe("Ours");
  });
});

describe("finding something", () => {
  beforeEach(async () => {
    await log({
      action: AUDIT_ACTIONS.LOAN_ISSUED,
      actorLabel: "Priya Librarian",
      entityType: "loan",
      occurredAt: new Date("2026-08-01T10:00:00Z"),
    });
    await log({
      action: AUDIT_ACTIONS.LOAN_RETURNED,
      actorLabel: "Priya Librarian",
      entityType: "loan",
      occurredAt: new Date("2026-08-10T10:00:00Z"),
    });
    await log({
      action: AUDIT_ACTIONS.BOOK_COPY_CREATED,
      actorLabel: "Sam Admin",
      entityType: "book_copy",
      occurredAt: new Date("2026-08-15T10:00:00Z"),
    });
    await actingAs(admin.id);
  });

  it("shows the newest first", async () => {
    const page = await listAuditEvents();
    expect(page.entries.map((entry) => entry.action)).toEqual([
      AUDIT_ACTIONS.BOOK_COPY_CREATED,
      AUDIT_ACTIONS.LOAN_RETURNED,
      AUDIT_ACTIONS.LOAN_ISSUED,
    ]);
  });

  it("filters by what happened", async () => {
    const page = await listAuditEvents({ action: AUDIT_ACTIONS.LOAN_ISSUED });
    expect(page.total).toBe(1);
    expect(page.entries[0].action).toBe(AUDIT_ACTIONS.LOAN_ISSUED);
  });

  it("filters by who, without needing their exact name", async () => {
    const page = await listAuditEvents({ actor: "priya" });
    expect(page.total).toBe(2);
  });

  it("filters by the kind of record", async () => {
    const page = await listAuditEvents({ entityType: "book_copy" });
    expect(page.total).toBe(1);
  });

  it("filters by date, inclusive at both ends", async () => {
    const page = await listAuditEvents({ from: "2026-08-10", to: "2026-08-10" });
    expect(page.total).toBe(1);
    expect(page.entries[0].action).toBe(AUDIT_ACTIONS.LOAN_RETURNED);
  });

  it("offers only the actions and kinds actually present", async () => {
    const page = await listAuditEvents();
    expect(page.availableActions).toEqual([
      AUDIT_ACTIONS.BOOK_COPY_CREATED,
      AUDIT_ACTIONS.LOAN_ISSUED,
      AUDIT_ACTIONS.LOAN_RETURNED,
    ]);
    expect(page.availableEntityTypes).toEqual(["book_copy", "loan"]);
  });

  it("says plainly when nothing matches", async () => {
    const page = await listAuditEvents({ actor: "nobody at all" });
    expect(page.total).toBe(0);
    expect(page.entries).toEqual([]);
    expect(page.pageCount).toBe(1);
  });
});

describe("pages", () => {
  it("splits a long log and keeps the pages in order", async () => {
    const total = AUDIT_PAGE_SIZE + 5;
    for (let index = 0; index < total; index += 1) {
      await log({
        action: AUDIT_ACTIONS.LOAN_ISSUED,
        actorLabel: `Actor ${index}`,
        occurredAt: new Date(Date.UTC(2026, 7, 1, 0, index)),
      });
    }

    await actingAs(admin.id);

    const first = await listAuditEvents({ page: 1 });
    expect(first.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.total).toBe(total);
    expect(first.pageCount).toBe(2);

    const second = await listAuditEvents({ page: 2 });
    expect(second.entries).toHaveLength(5);

    // No row appears on both pages.
    const ids = new Set([...first.entries, ...second.entries].map((entry) => entry.id));
    expect(ids.size).toBe(total);
  });

  it("treats a nonsense page number as the first page", async () => {
    await log({ action: AUDIT_ACTIONS.LOAN_ISSUED });
    await actingAs(admin.id);

    expect((await listAuditEvents({ page: -3 })).page).toBe(1);
    expect((await listAuditEvents({ page: 0 })).page).toBe(1);
  });
});

describe("what the details column may show", () => {
  it("shows a configuration change, because it is policy and not a person", async () => {
    await actingAs(admin.id);
    await updateLibrarySettings({ ...VALID_SETTINGS, borrowingPeriodDays: "21" });

    const page = await listAuditEvents({ action: AUDIT_ACTIONS.SETTINGS_UPDATED });
    expect(page.entries[0].details).toMatchObject({
      changes: { borrowingPeriodDays: { from: 14, to: 21 } },
    });
  });

  it("withholds every other action's metadata", async () => {
    await log({
      action: AUDIT_ACTIONS.LOAN_ISSUED,
      metadata: { childName: "A real child", bookTitle: "A real book" },
    });

    await actingAs(admin.id);
    const page = await listAuditEvents({ action: AUDIT_ACTIONS.LOAN_ISSUED });

    expect(page.entries[0].details).toBeNull();
    // Not merely hidden by the component — it never leaves the service.
    expect(JSON.stringify(page.entries[0])).not.toContain("A real child");
  });

  it("still keeps the row itself readable", async () => {
    await log({
      action: AUDIT_ACTIONS.MEMBER_PHOTO_REMOVED,
      actorLabel: "Sam Admin",
      entityType: "member_profile",
      metadata: { reason: "A family asked" },
    });

    await actingAs(admin.id);
    const [entry] = (await listAuditEvents()).entries;

    expect(entry.action).toBe(AUDIT_ACTIONS.MEMBER_PHOTO_REMOVED);
    expect(entry.actorLabel).toBe("Sam Admin");
    expect(entry.entityType).toBe("member_profile");
    expect(entry.details).toBeNull();
  });
});

describe("reading changes nothing", () => {
  it("leaves every row exactly as it was", async () => {
    const row = await log({
      action: AUDIT_ACTIONS.LOAN_ISSUED,
      metadata: { note: "unchanged" },
    });

    await actingAs(admin.id);
    await listAuditEvents();
    await listAuditEvents({ actor: "Someone" });

    const after = await db.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toEqual(row);
    expect(await db.auditLog.count()).toBe(1);
  });
});
