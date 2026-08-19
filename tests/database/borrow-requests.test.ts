import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import {
  cancelOwnBorrowRequest,
  countPendingBorrowRequests,
  decideBorrowRequest,
  getOwnBorrowStateForCode,
  issueBook,
  listOwnBorrowRequests,
  listPendingBorrowRequests,
  requestBorrow,
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
 * A child asks for a book; a librarian hands it over.
 *
 * The properties under test are almost all about the gap between those two
 * sentences. A request is a question, and until somebody at the desk answers
 * it:
 *
 *   1. no book has moved — the copy is still AVAILABLE and no loan exists;
 *   2. it cannot be made on another child's behalf, because the service takes
 *      no member id and reads the session;
 *   3. only one child at a time can be waiting for one physical copy, enforced
 *      by a partial unique index rather than by hopeful ordering;
 *   4. approving it runs the *same* issue the desk button runs, so every
 *      borrowing rule applies without this path knowing any of them.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;
let otherReader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** A copy on the shelf, and the code printed on its label. */
async function shelved() {
  const copy = await createBookCopy(fixture.libraryId);
  return { copyId: copy.id, code: copy.copyCode };
}

/** The child asks, and the librarian sees one thing waiting. */
async function askFor(code: string, who = reader) {
  await actingAs(who.id, "MEMBER");
  await requestBorrow({ code });

  await actingAs(librarian.id);
  const [request] = await listPendingBorrowRequests();
  return request;
}

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

describe("a child asks for a book", () => {
  it("records the ask and moves nothing at all", async () => {
    const copy = await shelved();

    await actingAs(reader.id, "MEMBER");
    const result = await requestBorrow({ code: copy.code });
    expect(result.title).toBeTruthy();

    const request = await db.borrowRequest.findFirstOrThrow();
    expect(request.status).toBe("PENDING");
    expect(request.copyId).toBe(copy.copyId);
    expect(request.memberUserId).toBe(reader.id);
    expect(request.decidedById).toBeNull();
    expect(request.loanId).toBeNull();

    // The whole point of it being a request: the book has not left the room.
    const after = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.copyId } });
    expect(after.status).toBe("AVAILABLE");
    expect(await db.loan.count()).toBe(0);
  });

  it("writes an audit row naming the copy", async () => {
    const copy = await shelved();
    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.code });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.BORROW_REQUESTED },
    });
    expect(entry.actorUserId).toBe(reader.id);
    expect(JSON.stringify(entry.metadata)).toContain(copy.code);
  });

  it("refuses a book that is not on the shelf", async () => {
    const copy = await shelved();
    await actingAs(librarian.id);
    await issueBook({ memberUserId: otherReader.id, copyId: copy.copyId });

    await actingAs(reader.id, "MEMBER");
    await expect(requestBorrow({ code: copy.code })).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
    expect(await db.borrowRequest.count()).toBe(0);
  });

  it("says nothing about a book that does not exist", async () => {
    await actingAs(reader.id, "MEMBER");
    // Not-found, and the same answer for a code from another library — a child
    // typing codes learns nothing about a catalogue they cannot see.
    await expect(requestBorrow({ code: "MJCL-B9999" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lets only one child at a time wait for one physical copy", async () => {
    const copy = await shelved();

    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.code });

    await actingAs(otherReader.id, "MEMBER");
    await expect(requestBorrow({ code: copy.code })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await db.borrowRequest.count({ where: { status: "PENDING" } })).toBe(1);
  });

  it("refuses the same child asking twice", async () => {
    const copy = await shelved();
    await actingAs(reader.id, "MEMBER");

    await requestBorrow({ code: copy.code });
    await expect(requestBorrow({ code: copy.code })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("counts books asked for against the borrowing limit", async () => {
    // Two is the library's limit. A pending request is a book the child is
    // expecting, so two asks fill it exactly as two loans would — otherwise a
    // child could ask for nine and a librarian would have to say no eight times.
    const [one, two, three] = [await shelved(), await shelved(), await shelved()];

    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: one.code });
    await requestBorrow({ code: two.code });

    await expect(requestBorrow({ code: three.code })).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses a child whose account is not active", async () => {
    /*
     * Two layers, and the outer one wins: a session is resolved against the
     * user's *current* status on every request, so a paused account stops being
     * signed in the moment it is paused. The ask never gets as far as the
     * borrowing rules.
     *
     * `requestBorrow` re-reads the status anyway. That check is unreachable
     * today and deliberately kept — it is one line, it does not depend on the
     * session layer keeping its promise, and it is the same belt-and-braces the
     * issue path uses.
     */
    const copy = await shelved();

    await actingAs(reader.id, "MEMBER");
    await db.appUser.update({ where: { id: reader.id }, data: { status: "SUSPENDED" } });

    await expect(requestBorrow({ code: copy.code })).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
    expect(await db.borrowRequest.count()).toBe(0);
  });

  it("is not something a librarian can do on a child's behalf", async () => {
    const copy = await shelved();
    await actingAs(librarian.id);

    // A librarian does not hold `loan.request` at all. They issue books; they
    // do not put words in a child's mouth.
    await expect(requestBorrow({ code: copy.code })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("can be taken back, leaving the record behind", async () => {
    const copy = await shelved();
    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.code });
    await cancelOwnBorrowRequest({ code: copy.code });

    const request = await db.borrowRequest.findFirstOrThrow();
    expect(request.status).toBe("CANCELLED");

    // Cancelling frees the copy for somebody else to ask about.
    await actingAs(otherReader.id, "MEMBER");
    await expect(requestBorrow({ code: copy.code })).resolves.toBeTruthy();
  });

  it("cannot cancel a request belonging to somebody else", async () => {
    const copy = await shelved();
    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.code });

    await actingAs(otherReader.id, "MEMBER");
    await expect(cancelOwnBorrowRequest({ code: copy.code })).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });

    const untouched = await db.borrowRequest.findFirstOrThrow();
    expect(untouched.status).toBe("PENDING");
  });
});

describe("a librarian answers", () => {
  it("approves, and the approval issues the book", async () => {
    const copy = await shelved();
    const request = await askFor(copy.code);

    const result = await decideBorrowRequest({
      requestId: request.requestId,
      decision: "APPROVE",
    });

    expect(result.decision).toBe("APPROVE");
    expect(result.readerName).toBe("Aarav Sharma");
    expect(result.dueAt).toBeInstanceOf(Date);

    // One loan, one borrowed copy, and the request points at the loan it made.
    const loan = await db.loan.findFirstOrThrow();
    expect(loan.memberUserId).toBe(reader.id);
    expect(loan.copyId).toBe(copy.copyId);
    expect(loan.status).toBe("ACTIVE");

    const decided = await db.borrowRequest.findUniqueOrThrow({ where: { id: request.requestId } });
    expect(decided.status).toBe("APPROVED");
    expect(decided.loanId).toBe(loan.id);
    expect(decided.decidedById).toBe(librarian.id);

    const after = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.copyId } });
    expect(after.status).toBe("BORROWED");
  });

  it("declines with a note, and the child is told", async () => {
    const copy = await shelved();
    const request = await askFor(copy.code);

    await decideBorrowRequest({
      requestId: request.requestId,
      decision: "DECLINE",
      reason: "it is being mended just now",
    });

    const decided = await db.borrowRequest.findUniqueOrThrow({ where: { id: request.requestId } });
    expect(decided.status).toBe("DECLINED");
    expect(decided.decisionNote).toBe("it is being mended just now");

    // No book moved.
    expect(await db.loan.count()).toBe(0);

    await actingAs(reader.id, "MEMBER");
    const mine = await listOwnBorrowRequests();
    expect(mine).toHaveLength(1);
    expect(mine[0].state).toBe("declined");
    expect(mine[0].decisionNote).toBe("it is being mended just now");
  });

  it("will not decline without saying something", async () => {
    const copy = await shelved();
    const request = await askFor(copy.code);

    await expect(
      decideBorrowRequest({ requestId: request.requestId, decision: "DECLINE", reason: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("cannot answer the same request twice", async () => {
    const copy = await shelved();
    const request = await askFor(copy.code);

    await decideBorrowRequest({ requestId: request.requestId, decision: "APPROVE" });
    await expect(
      decideBorrowRequest({ requestId: request.requestId, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    expect(await db.loan.count()).toBe(1);
  });

  it("obeys the borrowing limit it never mentions", async () => {
    /*
     * The point of routing approval through the desk's own issue: this test
     * names no rule. The child already has the library's maximum, the librarian
     * presses approve, and the limit refuses — enforced by `issueLockedLoan`,
     * which the approval calls, and which this path knows nothing about.
     */
    const first = await shelved();
    const second = await shelved();
    await actingAs(librarian.id);
    await issueBook({ memberUserId: reader.id, copyId: first.copyId });
    await issueBook({ memberUserId: reader.id, copyId: second.copyId });

    // Asked for before the second book went out, so the request itself is valid.
    const third = await shelved();
    await db.borrowRequest.create({
      data: { copyId: third.copyId, memberUserId: reader.id, status: "PENDING" },
    });

    await actingAs(librarian.id);
    const [request] = await listPendingBorrowRequests();
    expect(request.blockedReason).toBeTruthy();

    await expect(
      decideBorrowRequest({ requestId: request.requestId, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    // A refused approval leaves the request pending: the librarian has learnt
    // something the child could not, and the next step is theirs to take.
    const still = await db.borrowRequest.findUniqueOrThrow({ where: { id: request.requestId } });
    expect(still.status).toBe("PENDING");
  });

  it("refuses a child whose account was paused after they asked", async () => {
    const copy = await shelved();
    const request = await askFor(copy.code);

    await db.appUser.update({ where: { id: reader.id }, data: { status: "SUSPENDED" } });

    await actingAs(librarian.id);
    await expect(
      decideBorrowRequest({ requestId: request.requestId, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });
  });

  it("is not something a reader can do", async () => {
    const copy = await shelved();
    const request = await askFor(copy.code);

    await actingAs(reader.id, "MEMBER");
    await expect(
      decideBorrowRequest({ requestId: request.requestId, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

    await expect(listPendingBorrowRequests()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(countPendingBorrowRequests()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});

describe("what each side can see", () => {
  it("shows the desk a count and a list of what is waiting", async () => {
    const one = await shelved();
    const two = await shelved();

    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: one.code });
    await actingAs(otherReader.id, "MEMBER");
    await requestBorrow({ code: two.code });

    await actingAs(librarian.id);
    expect(await countPendingBorrowRequests()).toBe(2);

    const rows = await listPendingBorrowRequests();
    expect(rows.map((row) => row.readerName).sort()).toEqual(["Aarav Sharma", "Meera Iyer"]);
    expect(rows.every((row) => row.blockedReason === null)).toBe(true);
  });

  it("shows a child only their own asks", async () => {
    const mineCopy = await shelved();
    const theirsCopy = await shelved();

    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: mineCopy.code });
    await actingAs(otherReader.id, "MEMBER");
    await requestBorrow({ code: theirsCopy.code });

    await actingAs(reader.id, "MEMBER");
    const mine = await listOwnBorrowRequests();
    expect(mine).toHaveLength(1);
    expect(mine[0].copyCode).toBe(mineCopy.code);
  });

  it("drops an ask off the child's list once it becomes a book", async () => {
    // An approved request is a loan, and the child sees it on their shelf. It
    // would be two entries for one book otherwise.
    const copy = await shelved();
    const request = await askFor(copy.code);
    await decideBorrowRequest({ requestId: request.requestId, decision: "APPROVE" });

    await actingAs(reader.id, "MEMBER");
    expect(await listOwnBorrowRequests()).toEqual([]);
  });

  it("tells the book page what this child may do about this book", async () => {
    const copy = await shelved();

    await actingAs(reader.id, "MEMBER");
    expect(await getOwnBorrowStateForCode(copy.code)).toMatchObject({
      canAsk: true,
      state: "none",
      alreadyBorrowed: false,
      spokenFor: false,
    });

    await requestBorrow({ code: copy.code });
    expect(await getOwnBorrowStateForCode(copy.code)).toMatchObject({
      canAsk: false,
      state: "pending",
    });

    // Another child sees the book is spoken for, and is not told by whom.
    await actingAs(otherReader.id, "MEMBER");
    const theirView = await getOwnBorrowStateForCode(copy.code);
    expect(theirView).toMatchObject({ canAsk: false, spokenFor: true, state: "none" });
    expect(JSON.stringify(theirView)).not.toContain("Aarav");
  });

  it("offers a librarian nothing on the book page", async () => {
    const copy = await shelved();
    await actingAs(librarian.id);

    expect(await getOwnBorrowStateForCode(copy.code)).toMatchObject({
      canAsk: false,
      state: "none",
    });
  });

  it("lets a child ask again once the book comes back", async () => {
    const copy = await shelved();
    const request = await askFor(copy.code);
    await decideBorrowRequest({ requestId: request.requestId, decision: "APPROVE" });

    const loan = await db.loan.findFirstOrThrow();
    await actingAs(librarian.id);
    await returnBook({ loanId: loan.id });

    await actingAs(reader.id, "MEMBER");
    expect(await getOwnBorrowStateForCode(copy.code)).toMatchObject({ canAsk: true });
    await expect(requestBorrow({ code: copy.code })).resolves.toBeTruthy();
  });
});
