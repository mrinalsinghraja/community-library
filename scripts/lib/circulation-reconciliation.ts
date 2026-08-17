import type { PrismaClient } from "@prisma/client";

/**
 * Resolving a book whose record and whose shelf disagree.
 *
 * Phase 2 let a librarian type "Borrowed" as a book's status, with no loan
 * behind it and therefore no borrower. Phase 3's migration refuses to run while
 * any such copy exists, because every automatic repair is a claim a deployment
 * cannot support:
 *
 *   * "It is on the shelf" — it may be in a child's bag, and the next reader
 *     would be promised a book nobody can hand them.
 *   * "Child X has it" — nothing in the database knows that, and an invented
 *     borrower would sit in a real child's history forever.
 *
 * So the decision belongs to a person who can walk to the shelf and ask. This
 * module is what they use once they have. Everything here is deliberate,
 * per-copy, reason-bearing and audited under the operator's own name; there is
 * no "fix everything" call, because there is no fact that covers everything.
 *
 * **Raw SQL throughout, on purpose.** This runs against a database that has not
 * been migrated yet, whose columns do not match the generated Prisma client.
 * These statements touch only columns that existed in Phase 0.
 *
 * The three resolutions map onto the only three things that can be true:
 *
 *   | What the operator found        | Resolution      | Copy ends as |
 *   |--------------------------------|-----------------|--------------|
 *   | The book is on the shelf       | `markOnShelf`   | AVAILABLE    |
 *   | A named child has it           | `recordLoan`    | BORROWED     |
 *   | Nobody knows where it is       | `markMissing`   | LOST         |
 *
 * LOST is the honest answer to "we do not have it and we do not know who does".
 * It is a real state the catalogue already understands, it does not promise the
 * book to anyone, and it does not name a child.
 */

export interface StrandedCopy {
  copyId: string;
  copyCode: string;
  libraryId: string;
  libraryName: string;
  title: string;
  /** When the copy was last touched — usually when someone typed BORROWED. */
  updatedAt: Date;
}

/** Every copy that reads BORROWED with nothing behind it. */
export async function findStrandedCopies(prisma: PrismaClient): Promise<StrandedCopy[]> {
  const rows = await prisma.$queryRaw<
    {
      copy_id: string;
      copy_code: string;
      library_id: string;
      library_name: string;
      title: string;
      updated_at: Date;
    }[]
  >`
    SELECT c.id          AS copy_id,
           c.copy_code   AS copy_code,
           c.library_id  AS library_id,
           lib.name      AS library_name,
           t.title       AS title,
           c.updated_at  AS updated_at
      FROM book_copy c
      JOIN book_title t ON t.id = c.title_id
      JOIN library lib  ON lib.id = c.library_id
     WHERE c.status = 'BORROWED'
       AND NOT EXISTS (
         SELECT 1 FROM loan l WHERE l.copy_id = c.id AND l.status = 'ACTIVE'
       )
     ORDER BY c.copy_code ASC
  `;

  return rows.map((row) => ({
    copyId: row.copy_id,
    copyCode: row.copy_code,
    libraryId: row.library_id,
    libraryName: row.library_name,
    title: row.title,
    updatedAt: row.updated_at,
  }));
}

export class ReconciliationError extends Error {}

/** Context every resolution demands: who decided, and on what grounds. */
export interface Decision {
  copyCode: string;
  /** A person's name. It goes in the audit log and stays there. */
  operator: string;
  /** Why. "Found on the returns trolley", not "cleanup". */
  reason: string;
}

async function locate(prisma: PrismaClient, copyCode: string): Promise<StrandedCopy> {
  const stranded = await findStrandedCopies(prisma);
  const matches = stranded.filter(
    (copy) => copy.copyCode.toLowerCase() === copyCode.trim().toLowerCase(),
  );

  if (matches.length === 0) {
    throw new ReconciliationError(
      `${copyCode} is not one of the copies needing reconciliation. Run this script with no arguments to see the list.`,
    );
  }
  // Codes are unique per library, so two communities in one database could each
  // hold the same string. Refusing beats guessing which one the operator meant.
  if (matches.length > 1) {
    throw new ReconciliationError(
      `${copyCode} exists in more than one library (${matches.map((m) => m.libraryName).join(", ")}). Resolve it with a database that holds one library, or by copy id.`,
    );
  }

  return matches[0]!;
}

function requireContext(decision: Decision): void {
  if (!decision.operator.trim()) {
    throw new ReconciliationError("An operator name is required: the audit log records who decided.");
  }
  if (decision.reason.trim().length < 10) {
    throw new ReconciliationError(
      "A reason of at least 10 characters is required: 'cleanup' is not a record of anything.",
    );
  }
}

async function writeAudit(
  prisma: PrismaClient,
  copy: StrandedCopy,
  decision: Decision,
  toStatus: string,
  extra: Record<string, string> = {},
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO audit_log (id, library_id, action, entity_type, entity_id,
                           actor_user_id, actor_label, metadata, occurred_at)
    VALUES (gen_random_uuid()::text,
            ${copy.libraryId},
            'loan.corrected',
            'book_copy',
            ${copy.copyId},
            NULL,
            ${decision.operator.trim()},
            ${JSON.stringify({
              copyCode: copy.copyCode,
              from: "BORROWED",
              to: toStatus,
              reason: decision.reason.trim(),
              via: "reconcile-circulation",
              ...extra,
            })}::jsonb,
            now())
  `;
}

/** The book is on the shelf. Only an operator who has seen it may say so. */
export async function markOnShelf(prisma: PrismaClient, decision: Decision): Promise<StrandedCopy> {
  requireContext(decision);
  const copy = await locate(prisma, decision.copyCode);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE book_copy SET status = 'AVAILABLE', updated_at = now() WHERE id = ${copy.copyId}
    `;
    await writeAudit(tx as PrismaClient, copy, decision, "AVAILABLE");
  });

  return copy;
}

/**
 * Nobody knows where the book is.
 *
 * Not a failure to reconcile — it is the reconciliation. The library does not
 * have the book, does not know who does, and now says exactly that.
 */
export async function markMissing(prisma: PrismaClient, decision: Decision): Promise<StrandedCopy> {
  requireContext(decision);
  const copy = await locate(prisma, decision.copyCode);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE book_copy SET status = 'LOST', updated_at = now() WHERE id = ${copy.copyId}
    `;
    await writeAudit(tx as PrismaClient, copy, decision, "LOST");
  });

  return copy;
}

export interface KnownBorrower extends Decision {
  /** The child's library card, e.g. `MJCL-R0007`. */
  memberCode: string;
  /** When they took it. The operator's knowledge, not today's date. */
  issuedAt: Date;
  /** When it is due back. */
  dueAt: Date;
}

/**
 * A named child has the book, and the operator knows which child.
 *
 * This is the one resolution that creates a loan, and the reason it is allowed
 * is that no software invented anything: a person typed the card number of the
 * child they know is holding the book. The loan carries the real dates, so the
 * child's history reads as what happened rather than as what the upgrade found
 * convenient. `issuedById` stays null — no member of staff issued it through
 * the desk, and pretending otherwise would be its own small fiction.
 */
export async function recordLoan(
  prisma: PrismaClient,
  decision: KnownBorrower,
): Promise<StrandedCopy> {
  requireContext(decision);
  const copy = await locate(prisma, decision.copyCode);

  if (decision.dueAt <= decision.issuedAt) {
    throw new ReconciliationError("The due date must be after the issue date.");
  }

  const [member] = await prisma.$queryRaw<{ user_id: string; display_name: string }[]>`
    SELECT m.user_id, u.display_name
      FROM member_profile m
      JOIN app_user u ON u.id = m.user_id
     WHERE m.library_id = ${copy.libraryId}
       AND lower(m.member_code) = ${decision.memberCode.trim().toLowerCase()}
  `;

  if (!member) {
    throw new ReconciliationError(
      `No member holds card ${decision.memberCode} in ${copy.libraryName}. Check the card number rather than guessing — a wrong one puts this book in the wrong child's history.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const [loan] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO loan (id, library_id, copy_id, member_user_id, status,
                        issued_at, issued_by_id, due_at, renewal_count)
      VALUES (gen_random_uuid()::text, ${copy.libraryId}, ${copy.copyId}, ${member.user_id},
              'ACTIVE', ${decision.issuedAt}, NULL, ${decision.dueAt}, 0)
      RETURNING id
    `;

    await tx.$executeRaw`
      INSERT INTO loan_event (id, loan_id, type, occurred_at, actor_user_id, note)
      VALUES (gen_random_uuid()::text, ${loan!.id}, 'ISSUE', ${decision.issuedAt}, NULL,
              ${`Recorded during Phase 3 reconciliation by ${decision.operator.trim()}: ${decision.reason.trim()}`})
    `;

    // The copy already reads BORROWED and stays that way. It is now true.
    await writeAudit(tx as PrismaClient, copy, decision, "BORROWED", {
      memberCode: decision.memberCode.trim(),
      loanRecorded: "true",
    });
  });

  return copy;
}
