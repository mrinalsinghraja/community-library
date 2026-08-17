import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { ROLE_DEFINITIONS } from "@/lib/permissions";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import {
  cancelOwnRenewalRequest,
  countPendingRenewalRequests,
  decideRenewalRequest,
  issueBook,
  listOwnLoans,
  listPendingRenewalRequests,
  renewLoan,
  requestRenewal,
  returnBook,
} from "@/server/services/circulation-service";

import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * A child asks; a librarian decides.
 *
 * This is the only write in the application a reader can cause, which makes it
 * the one place where a child's input reaches the library's records — so the
 * properties under test are mostly about what a request *cannot* do:
 *
 *   1. It cannot reach another child's loan. The service takes no member id;
 *      the code on the book is resolved against the session's own loans.
 *   2. It cannot change a due date. Until a librarian answers, the loan is
 *      exactly as it was.
 *   3. It cannot be answered twice, and it cannot produce two renewals — under
 *      concurrency, enforced by row locks and a partial unique index rather
 *      than by hopeful ordering.
 *   4. Approving it runs the *same* renewal the desk button runs. There is no
 *      second code path with its own idea of the rules.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;
let otherReader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** Issues a book to a reader and returns what the child's screen would show. */
async function lend(memberUserId: string) {
  const copy = await createBookCopy(fixture.libraryId);
  await actingAs(librarian.id);
  const issued = await issueBook({ memberUserId, copyId: copy.id });
  return { loanId: issued.loanId, copyId: copy.id, code: issued.copyCode };
}

/**
 * A second community sharing the same deployment.
 *
 * Not `createLibraryFixture` twice: the permission catalogue is one global
 * table and seeding it again collides. What a tenancy test needs is a second
 * library with its own roles, which is this.
 */
async function createNeighbouringLibrary(): Promise<string> {
  const community = await db.community.create({
    data: { name: "Next Door", slug: `next-door-${Date.now()}`, city: "Test City" },
  });

  const library = await db.library.create({
    data: {
      communityId: community.id,
      name: "Next Door Library",
      slug: `next-door-library-${Date.now()}`,
      settings: { create: { copyCodePrefix: "ND-B", memberCodePrefix: "ND-R" } },
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

  return library.id;
}

/** Moves a whole loan into the past, which is how "already late" is built. */
async function makeOverdue(loanId: string) {
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() - 3);
  const issuedAt = new Date(dueAt);
  issuedAt.setDate(issuedAt.getDate() - 14);
  await db.loan.update({ where: { id: loanId }, data: { dueAt, issuedAt } });
}

beforeAll(() => {
  // Nothing global to arrange: every test signs in as whoever it is about.
});

afterAll(async () => {
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  reader = await createMember(fixture.libraryId, { displayName: "Aarav Sharma" });
  otherReader = await createMember(fixture.libraryId, { displayName: "Meera Iyer" });
});

describe("a child asks", () => {
  it("records the ask and changes nothing else", async () => {
    const loan = await lend(reader.id);
    const before = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });

    await actingAs(reader.id, "MEMBER");
    const result = await requestRenewal({ code: loan.code });

    expect(result.title).toBeTruthy();

    const request = await db.renewalRequest.findFirstOrThrow();
    expect(request.status).toBe("PENDING");
    expect(request.loanId).toBe(loan.loanId);
    expect(request.requestedById).toBe(reader.id);
    expect(request.decidedById).toBeNull();

    // The whole point of it being a request: nothing about the book moved.
    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    expect(after.dueAt.getTime()).toBe(before.dueAt.getTime());
    expect(after.renewalCount).toBe(0);
    expect(after.status).toBe("ACTIVE");
    expect(await db.loanEvent.count({ where: { loanId: loan.loanId, type: "RENEW" } })).toBe(0);
  });

  it("writes an audit row naming the book", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.RENEWAL_REQUESTED },
    });
    expect(audit.actorUserId).toBe(reader.id);
    expect(audit.metadata).toMatchObject({ copyCode: loan.code });
  });

  it("accepts the code however it is typed", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");

    await requestRenewal({ code: `  ${loan.code.toLowerCase()}  ` });

    expect(await db.renewalRequest.count()).toBe(1);
  });
});

describe("a child cannot ask about somebody else's book", () => {
  it("refuses another child's loan with a sentence that reveals nothing", async () => {
    const theirs = await lend(otherReader.id);

    await actingAs(reader.id, "MEMBER");
    await expect(requestRenewal({ code: theirs.code })).rejects.toMatchObject({
      friendlyMessage: "We could not find that book on your shelf.",
    });

    expect(await db.renewalRequest.count()).toBe(0);
  });

  it("gives the same answer for a book that does not exist", async () => {
    await actingAs(reader.id, "MEMBER");

    // Identical wording, so a child cannot use the difference to work out which
    // codes are real or who is holding what.
    await expect(requestRenewal({ code: "TST-B9999" })).rejects.toMatchObject({
      friendlyMessage: "We could not find that book on your shelf.",
    });
  });

  it("refuses a book that has already been brought back", async () => {
    const loan = await lend(reader.id);
    await actingAs(librarian.id);
    await returnBook({ loanId: loan.loanId });

    await actingAs(reader.id, "MEMBER");
    await expect(requestRenewal({ code: loan.code })).rejects.toMatchObject({
      friendlyMessage: "We could not find that book on your shelf.",
    });
  });

  it("shows a child their own request and nobody else's", async () => {
    const mine = await lend(reader.id);
    await lend(otherReader.id);

    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: mine.code });

    const own = await listOwnLoans();
    expect(own?.active).toHaveLength(1);
    expect(own?.active[0]?.renewalState).toBe("pending");

    await actingAs(otherReader.id, "MEMBER");
    const theirs = await listOwnLoans();
    expect(theirs?.active).toHaveLength(1);
    // Meera's own book is untouched by Aarav's asking, and Aarav's book is not
    // on her screen at all.
    expect(theirs?.active[0]?.renewalState).toBe("none");
    expect(theirs?.active[0]?.code).not.toBe(mine.code);
  });

  it("does not let a reader answer a request", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    // Still signed in as the child, holding loan.request_renewal only.
    await expect(
      decideRenewalRequest({ requestId: request.id, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

    await expect(listPendingRenewalRequests()).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    expect((await db.renewalRequest.findFirstOrThrow()).status).toBe("PENDING");
  });

  it("has nothing for a librarian's own shelf", async () => {
    const loan = await lend(reader.id);
    await actingAs(librarian.id);

    // Staff hold loan.renew, not loan.request_renewal, and have no library card.
    await expect(requestRenewal({ code: loan.code })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });
});

describe("asking twice", () => {
  it("refuses a second open request with a gentle sentence", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });

    await expect(requestRenewal({ code: loan.code })).rejects.toMatchObject({
      friendlyMessage: "You have already asked about this book. The librarian will see it.",
    });

    expect(await db.renewalRequest.count()).toBe(1);
  });

  it("survives two taps at the same instant", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");

    const results = await Promise.allSettled([
      requestRenewal({ code: loan.code }),
      requestRenewal({ code: loan.code }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.renewalRequest.count()).toBe(1);
  });

  it("lets a child ask again after a librarian has answered", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });

    await actingAs(librarian.id);
    const first = await db.renewalRequest.findFirstOrThrow();
    await decideRenewalRequest({
      requestId: first.id,
      decision: "DECLINE",
      reason: "Someone else is waiting for it",
    });

    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });

    // Both asks survive. "The librarian said no on Tuesday" is part of what
    // happened, and the second ask does not overwrite it.
    const all = await db.renewalRequest.findMany({ orderBy: { requestedAt: "asc" } });
    expect(all.map((request) => request.status)).toEqual(["DECLINED", "PENDING"]);
  });
});

describe("the rules a child is told straight away", () => {
  it("will not take an ask for a book already kept longer once", async () => {
    const loan = await lend(reader.id);
    await actingAs(librarian.id);
    await renewLoan({ loanId: loan.loanId });

    await actingAs(reader.id, "MEMBER");
    await expect(requestRenewal({ code: loan.code })).rejects.toMatchObject({
      friendlyMessage: "You have already kept this one for longer once. Please bring it back.",
    });
    expect(await db.renewalRequest.count()).toBe(0);
  });

  it("will not take an ask for a book that is already late", async () => {
    const loan = await lend(reader.id);
    await makeOverdue(loan.loanId);

    await actingAs(reader.id, "MEMBER");
    await expect(requestRenewal({ code: loan.code })).rejects.toMatchObject({
      friendlyMessage:
        "This one was due back already. Please bring it in — you can borrow it again after.",
    });
  });

  it("offers the ask on the child's own screen, and withdraws it when a rule bites", async () => {
    const loan = await lend(reader.id);

    await actingAs(reader.id, "MEMBER");
    const before = await listOwnLoans();
    expect(before?.active[0]?.canAskToKeep).toBe(true);
    expect(before?.active[0]?.askBlockedReason).toBeNull();
    expect(before?.renewalPeriodDays).toBe(14);

    await makeOverdue(loan.loanId);

    const after = await listOwnLoans();
    expect(after?.active[0]?.canAskToKeep).toBe(false);
    expect(after?.active[0]?.askBlockedReason).toMatch(/due back already/);
    // Never a status name, never a policy, never an id.
    expect(after?.active[0]?.askBlockedReason).not.toMatch(/ACTIVE|SUSPENDED|renewal_count/i);
  });

  it("cannot be asked at all once an account is paused", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await db.appUser.update({ where: { id: reader.id }, data: { status: "SUSPENDED" } });

    /*
     * Pausing an account invalidates its sessions on the very next request
     * (Phase 0), so the eligibility branch inside `requestRenewal` is not even
     * the guard that bites here — the door is shut one layer earlier. Both
     * layers exist on purpose; this asserts the outer one, and the desk-side
     * test below covers what a librarian sees for a request already open.
     */
    await expect(requestRenewal({ code: loan.code })).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
    expect(await db.renewalRequest.count()).toBe(0);
  });

  it("shows the desk that a paused reader's open request cannot be granted", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });

    // The account is paused after the ask — which is the order this actually
    // happens in, since a paused reader cannot ask.
    await db.appUser.update({ where: { id: reader.id }, data: { status: "SUSPENDED" } });

    await actingAs(librarian.id);
    const [row] = await listPendingRenewalRequests();
    expect(row?.blockedReason).toBe("This library account is currently unavailable for borrowing.");

    const request = await db.renewalRequest.findFirstOrThrow();
    await expect(
      decideRenewalRequest({ requestId: request.id, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    expect((await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } })).renewalCount).toBe(0);
  });
});

describe("a child changes their mind", () => {
  it("cancels their own pending request, and the row stays", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });

    await cancelOwnRenewalRequest({ code: loan.code });

    const request = await db.renewalRequest.findFirstOrThrow();
    expect(request.status).toBe("CANCELLED");
    expect(request.decidedById).toBe(reader.id);

    // Cancelled is not the same as never asked: the desk no longer sees it, and
    // the child may ask again.
    await actingAs(librarian.id);
    expect(await countPendingRenewalRequests()).toBe(0);

    await actingAs(reader.id, "MEMBER");
    const own = await listOwnLoans();
    expect(own?.active[0]?.renewalState).toBe("none");
    expect(own?.active[0]?.canAskToKeep).toBe(true);
  });

  it("cannot cancel when there is nothing pending", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");

    await expect(cancelOwnRenewalRequest({ code: loan.code })).rejects.toMatchObject({
      friendlyMessage: "There is nothing to cancel for this book.",
    });
  });

  it("cannot cancel another child's request", async () => {
    const theirs = await lend(otherReader.id);
    await actingAs(otherReader.id, "MEMBER");
    await requestRenewal({ code: theirs.code });

    await actingAs(reader.id, "MEMBER");
    await expect(cancelOwnRenewalRequest({ code: theirs.code })).rejects.toMatchObject({
      friendlyMessage: "We could not find that book on your shelf.",
    });

    expect((await db.renewalRequest.findFirstOrThrow()).status).toBe("PENDING");
  });
});

describe("the librarian's list", () => {
  it("shows what is waiting, with the rule already evaluated", async () => {
    const mine = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: mine.code });

    await actingAs(librarian.id);
    const [row] = await listPendingRenewalRequests();

    expect(row?.readerName).toBe("Aarav Sharma");
    expect(row?.copyCode).toBe(mine.code);
    expect(row?.blockedReason).toBeNull();
    expect(row?.maxRenewals).toBe(1);
    expect(await countPendingRenewalRequests()).toBe(1);
  });

  it("carries nothing about the family", async () => {
    const mine = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: mine.code });

    await actingAs(librarian.id);
    const [row] = await listPendingRenewalRequests();

    const keys = Object.keys(row ?? {});
    for (const forbidden of ["guardian", "email", "phone", "apartment", "status", "memberUserId"]) {
      expect(keys.join(",")).not.toContain(forbidden);
    }
  });

  it("explains a request the rules will not allow, instead of hiding it", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });

    // The book goes overdue between the ask and the answer, which is exactly
    // what happens when a request sits over a weekend.
    await makeOverdue(loan.loanId);

    await actingAs(librarian.id);
    const [row] = await listPendingRenewalRequests();

    expect(row).toBeDefined();
    expect(row?.blockedReason).toMatch(/past its date/);
  });
});

describe("the librarian answers", () => {
  it("approves, and that performs the renewal", async () => {
    const loan = await lend(reader.id);
    const before = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });

    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    await actingAs(librarian.id);
    const result = await decideRenewalRequest({ requestId: request.id, decision: "APPROVE" });

    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });

    expect(result.decision).toBe("APPROVE");
    expect(after.renewalCount).toBe(1);
    expect(after.dueAt.getTime()).toBeGreaterThan(before.dueAt.getTime());
    // The issue date is never rewritten. A renewed loan is the same loan.
    expect(after.issuedAt.getTime()).toBe(before.issuedAt.getTime());

    const decided = await db.renewalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(decided.status).toBe("APPROVED");
    expect(decided.decidedById).toBe(librarian.id);
  });

  it("appends exactly one RENEW event, carrying both dates and its origin", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    await actingAs(librarian.id);
    await decideRenewalRequest({ requestId: request.id, decision: "APPROVE" });

    const events = await db.loanEvent.findMany({
      where: { loanId: loan.loanId, type: "RENEW" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.previousDueAt).not.toBeNull();
    expect(events[0]?.newDueAt).not.toBeNull();
    expect(events[0]?.actorUserId).toBe(librarian.id);
    expect(events[0]?.note).toMatch(/request/i);
  });

  it("declines with a note, and the loan is untouched", async () => {
    const loan = await lend(reader.id);
    const before = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });

    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    await actingAs(librarian.id);
    await decideRenewalRequest({
      requestId: request.id,
      decision: "DECLINE",
      reason: "Someone else has asked for this one",
    });

    const decided = await db.renewalRequest.findUniqueOrThrow({ where: { id: request.id } });
    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });

    expect(decided.status).toBe("DECLINED");
    expect(decided.decisionNote).toBe("Someone else has asked for this one");
    expect(after.dueAt.getTime()).toBe(before.dueAt.getTime());
    expect(after.renewalCount).toBe(0);
  });

  it("will not decline without a note", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    await actingAs(librarian.id);
    await expect(
      decideRenewalRequest({ requestId: request.id, decision: "DECLINE", reason: " " }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect((await db.renewalRequest.findFirstOrThrow()).status).toBe("PENDING");
  });

  it("tells the child what was decided, on their own screen", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    await actingAs(librarian.id);
    await decideRenewalRequest({
      requestId: request.id,
      decision: "DECLINE",
      reason: "Please bring it in",
    });

    await actingAs(reader.id, "MEMBER");
    const own = await listOwnLoans();
    expect(own?.active[0]?.renewalState).toBe("declined");
    // The librarian's note is not republished to the child verbatim: the screen
    // says one kind sentence, and the note is the library's own record.
    expect(JSON.stringify(own)).not.toContain("Please bring it in");
  });

  it("refuses a request that is no longer eligible, and leaves it pending", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    // The weekend passes and the book goes overdue before anybody answers.
    await makeOverdue(loan.loanId);

    await actingAs(librarian.id);
    await expect(
      decideRenewalRequest({ requestId: request.id, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    const after = await db.renewalRequest.findUniqueOrThrow({ where: { id: request.id } });
    const loanAfter = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });

    // Still pending: the librarian has learnt something and the next step is
    // theirs. Marking it declined would attribute a decision to nobody.
    expect(after.status).toBe("PENDING");
    expect(loanAfter.renewalCount).toBe(0);

    const refusal = await db.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.RENEWAL_REQUEST_REFUSED },
    });
    expect(refusal).not.toBeNull();
  });

  it("refuses when the allowance was used up at the desk in the meantime", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    // A librarian renews it at the desk while the child's ask is still open.
    await actingAs(librarian.id);
    await renewLoan({ loanId: loan.loanId });

    await expect(
      decideRenewalRequest({ requestId: request.id, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    expect(after.renewalCount).toBe(1);
  });

  it("refuses a request from another library", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    // A librarian whose session belongs to a different library: the id resolves
    // to nothing rather than to a permission error that would confirm it exists.
    const otherLibraryId = await createNeighbouringLibrary();
    const stranger = await createStaff(otherLibraryId, "LIBRARIAN");
    await actingAs(stranger.id);

    await expect(
      decideRenewalRequest({ requestId: request.id, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect((await db.renewalRequest.findFirstOrThrow()).status).toBe("PENDING");
  });
});

describe("two librarians at once", () => {
  it("answers a request exactly once", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    const second = await createStaff(fixture.libraryId, "LIBRARIAN");
    const [handleA, handleB] = await Promise.all([
      createSession(librarian.id, "STAFF"),
      createSession(second.id, "STAFF"),
    ]);

    /*
     * Two sessions, two genuinely parallel approvals of the same request.
     * Exactly one may win: the loser waits on the request's row lock, reads a
     * row that is no longer PENDING, and is refused. Neither a second approval
     * nor a second renewal is reachable.
     */
    const results = await Promise.allSettled([
      (async () => {
        __setSessionHandle(handleA);
        return decideRenewalRequest({ requestId: request.id, decision: "APPROVE" });
      })(),
      (async () => {
        __setSessionHandle(handleB);
        return decideRenewalRequest({ requestId: request.id, decision: "APPROVE" });
      })(),
    ]);

    const won = results.filter((result) => result.status === "fulfilled");
    expect(won).toHaveLength(1);

    const loanAfter = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    expect(loanAfter.renewalCount).toBe(1);
    expect(await db.loanEvent.count({ where: { loanId: loan.loanId, type: "RENEW" } })).toBe(1);
    expect((await db.renewalRequest.findFirstOrThrow()).status).toBe("APPROVED");
  });

  it("cannot approve and decline the same request", async () => {
    const loan = await lend(reader.id);
    await actingAs(reader.id, "MEMBER");
    await requestRenewal({ code: loan.code });
    const request = await db.renewalRequest.findFirstOrThrow();

    const second = await createStaff(fixture.libraryId, "LIBRARIAN");
    const [handleA, handleB] = await Promise.all([
      createSession(librarian.id, "STAFF"),
      createSession(second.id, "STAFF"),
    ]);

    const results = await Promise.allSettled([
      (async () => {
        __setSessionHandle(handleA);
        return decideRenewalRequest({ requestId: request.id, decision: "APPROVE" });
      })(),
      (async () => {
        __setSessionHandle(handleB);
        return decideRenewalRequest({
          requestId: request.id,
          decision: "DECLINE",
          reason: "Somebody else is waiting",
        });
      })(),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const decided = await db.renewalRequest.findFirstOrThrow();
    expect(["APPROVED", "DECLINED"]).toContain(decided.status);

    const loanAfter = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    expect(loanAfter.renewalCount).toBe(decided.status === "APPROVED" ? 1 : 0);
  });
});
