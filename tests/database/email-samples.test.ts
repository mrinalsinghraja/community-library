import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/email-samples/route";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { FakeEmailProvider } from "./fake-email";
import {
  attachGuardian,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * The sample sender (ADR-076): one of every email, only to staff, only with
 * the cron secret, and never carrying anything that opens an account.
 */

const mail = new FakeEmailProvider();
let fixture: Fixture;
const SECRET = "test-cron-secret-value";

function call(to: unknown, auth = `Bearer ${SECRET}`) {
  return POST(
    new NextRequest("http://localhost/api/email-samples", {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ to }),
    }),
  );
}

beforeAll(() => {
  process.env.CRON_SECRET = SECRET;
  __setEmailProviderForTests(mail);
});

afterAll(async () => {
  delete process.env.CRON_SECRET;
  __setEmailProviderForTests(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  mail.reset();
});

describe("email samples", () => {
  it("refuses without the secret, and says nothing about why", async () => {
    const response = await call("anyone@example.invalid", "Bearer wrong");
    expect(response.status).toBe(404);
    expect(mail.sent).toHaveLength(0);
  });

  it("refuses any address that is not an active member of staff", async () => {
    const reader = await createMember(fixture.libraryId, { displayName: "A Child" });
    await attachGuardian(fixture.libraryId, reader.id, "family@example.invalid");

    for (const to of ["family@example.invalid", "stranger@example.invalid", "", 42]) {
      expect((await call(to)).status).toBe(400);
    }
    expect(mail.sent).toHaveLength(0);
  });

  it("sends one of every email to a member of staff, all marked as samples", async () => {
    const staff = await createStaff(fixture.libraryId, "LIBRARIAN");
    const response = await call(staff.email!.toUpperCase());
    const body = (await response.json()) as { sent: number; failed: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ sent: 15, failed: 0 });
    expect(mail.sent).toHaveLength(15);
    expect(new Set(mail.sent.map((m) => m.template)).size).toBe(15);
    for (const message of mail.sent) {
      expect(message.to).toBe(staff.email);
      expect(message.subject.startsWith("[Sample] ")).toBe(true);
      // No live link of any kind: only the dead sample one.
      expect(message.text).not.toMatch(/\/(activate|reset|verify)\//);
    }
    expect(mail.sent.map((m) => m.template)).toEqual(
      expect.arrayContaining(["sample_activation", "sample_loan_issued", "sample_loan_overdue_weekly", "sample_loan_due_soon_7_days_before"]),
    );
  });
});
