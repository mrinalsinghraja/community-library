import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";

/**
 * Audit logging.
 *
 * Rule: every state change writes an audit row inside the same transaction as
 * the change itself. If the change rolls back, so does the record of it; if the
 * change commits, the record cannot be missing.
 */

export const AUDIT_ACTIONS = {
  // Authentication
  LOGIN_SUCCEEDED: "auth.login.succeeded",
  LOGIN_FAILED: "auth.login.failed",
  LOGOUT: "auth.logout",
  PASSWORD_CHANGED: "auth.password.changed",
  PASSWORD_RESET_REQUESTED: "auth.password_reset.requested",
  PASSWORD_RESET_COMPLETED: "auth.password_reset.completed",
  ACCOUNT_ACTIVATED: "auth.account.activated",
  SESSIONS_REVOKED: "auth.sessions.revoked",

  // Users and access
  USER_CREATED: "user.created",
  USER_SUSPENDED: "user.suspended",
  USER_REACTIVATED: "user.reactivated",
  USER_DEACTIVATED: "user.deactivated",
  ROLE_GRANTED: "user.role.granted",
  ROLE_REVOKED: "user.role.revoked",
  ROLE_PERMISSIONS_CHANGED: "role.permissions.changed",

  // Registration
  REGISTRATION_SUBMITTED: "registration.submitted",
  REGISTRATION_REVIEWED: "registration.reviewed",
  REGISTRATION_APPROVED: "registration.approved",
  REGISTRATION_REJECTED: "registration.rejected",
  CONSENT_RECORDED: "consent.recorded",
  CONSENT_WITHDRAWN: "consent.withdrawn",

  // Activation
  ACTIVATION_SENT: "activation.sent",
  ACTIVATION_REISSUED: "activation.reissued",
  ACTIVATION_FAILED: "activation.failed",

  // Guardians
  GUARDIAN_UPDATED: "guardian.updated",

  // Guardian verification — kept distinct from consent actions on purpose:
  // "a guardian agreed" and "we checked who they are" are different events.
  VERIFICATION_RECORDED: "verification.recorded",
  VERIFICATION_CHALLENGE_SENT: "verification.challenge.sent",
  VERIFICATION_COMPLETED: "verification.completed",
  VERIFICATION_FAILED: "verification.failed",
  VERIFICATION_REVOKED: "verification.revoked",

  // Child photographs. Every touch of a private child image is logged.
  MEMBER_PHOTO_ADDED: "member.photo.added",
  MEMBER_PHOTO_REPLACED: "member.photo.replaced",
  MEMBER_PHOTO_REMOVED: "member.photo.removed",

  // Catalogue
  //
  // Condition, status and category each get their own action rather than
  // hiding inside a generic "updated": those are the three answers somebody
  // asks the log about later ("when did this become Damaged?", "who took it
  // off the shelf?"), and grepping a metadata blob for them is not an answer.
  BOOK_TITLE_CREATED: "book.title.created",
  BOOK_TITLE_UPDATED: "book.title.updated",
  BOOK_COPY_CREATED: "book.copy.created",
  BOOK_COPY_UPDATED: "book.copy.updated",
  BOOK_COPY_ARCHIVED: "book.copy.archived",
  BOOK_COPY_DELETED: "book.copy.deleted",
  BOOK_COPY_DELETE_REFUSED: "book.copy.delete_refused",
  BOOK_COPY_STATUS_CHANGED: "book.copy.status_changed",
  BOOK_COPY_CONDITION_CHANGED: "book.copy.condition_changed",
  BOOK_CATEGORY_CHANGED: "book.title.category_changed",
  BOOK_COVER_ADDED: "book.cover.added",
  BOOK_COVER_REPLACED: "book.cover.replaced",
  BOOK_COVER_REMOVED: "book.cover.removed",
  DONATION_RECORDED: "donation.recorded",
  DONATION_UPDATED: "donation.updated",

  // Circulation
  //
  // Every one of these names a decision somebody made about a physical book and
  // a named child. `loan.issue.refused` is here deliberately: a refusal is the
  // interesting event when a family later asks why a child came home empty
  // handed, and it is the only trace an attempted rule bypass leaves.
  LOAN_ISSUED: "loan.issued",
  LOAN_ISSUE_REFUSED: "loan.issue.refused",
  LOAN_RETURNED: "loan.returned",
  LOAN_RENEWED: "loan.renewed",
  LOAN_CANCELLED: "loan.cancelled",
  LOAN_CORRECTED: "loan.corrected",
  LOAN_MARKED_LOST: "loan.marked_lost",

  // Renewal requests. A child asking is itself an event worth keeping: it is
  // the only action in this application a reader can take that a librarian is
  // expected to answer, and "did anyone ever reply?" has to be answerable.
  // The refusal is here for the same reason `loan.issue.refused` is — an
  // approval that the rules turned down is the interesting one.
  RENEWAL_REQUESTED: "renewal_request.created",
  RENEWAL_REQUEST_APPROVED: "renewal_request.approved",
  RENEWAL_REQUEST_DECLINED: "renewal_request.declined",
  RENEWAL_REQUEST_CANCELLED: "renewal_request.cancelled",
  RENEWAL_REQUEST_REFUSED: "renewal_request.refused",

  BORROW_REQUESTED: "borrow_request.created",
  BORROW_REQUEST_APPROVED: "borrow_request.approved",
  BORROW_REQUEST_DECLINED: "borrow_request.declined",
  BORROW_REQUEST_CANCELLED: "borrow_request.cancelled",
  BORROW_REQUEST_REFUSED: "borrow_request.refused",

  // Configuration
  SETTINGS_UPDATED: "settings.updated",
  BRANDING_UPDATED: "branding.updated",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Keys that must never reach the audit log, whatever a caller passes.
 * The log is read by administrators and exported during incidents; it is not a
 * place for anything that could authenticate someone.
 */
const FORBIDDEN_METADATA_KEYS = [
  "password",
  "passwordhash",
  "password_hash",
  "newpassword",
  "currentpassword",
  "token",
  "tokenhash",
  "token_hash",
  "secret",
  "authsecret",
  "auth_secret",
  "apikey",
  "api_key",
  "sessiontoken",
  "session_token",
  "cookie",
  "authorization",
  "smtppassword",
  "smtp_password",
  "databaseurl",
  "database_url",
];

/**
 * Strips anything that looks like a credential, recursively. This is a
 * belt-and-braces guard: callers are expected not to pass secrets, and this
 * ensures a careless call site cannot create a breach.
 */
export function redactMetadata(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => redactMetadata(item, depth + 1) ?? null) as Prisma.InputJsonValue;
  }

  if (typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const normalised = key.toLowerCase().replace(/[^a-z_]/g, "");
      if (FORBIDDEN_METADATA_KEYS.includes(normalised)) {
        output[key] = "[redacted]";
        continue;
      }
      const cleaned = redactMetadata(raw, depth + 1);
      if (cleaned !== undefined) output[key] = cleaned;
    }
    return output;
  }

  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();

  return value as Prisma.InputJsonValue;
}

export interface AuditInput {
  libraryId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** Null for anonymous actions such as a public registration submission. */
  actorUserId?: string | null;
  /** Denormalised so the log stays readable after an account is archived. */
  actorLabel: string;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Writes one audit row. Pass the transaction client when inside a transaction. */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      libraryId: input.libraryId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel,
      metadata: input.metadata ? redactMetadata(input.metadata) : undefined,
      ipHash: input.ipHash ?? null,
    },
  });
}
