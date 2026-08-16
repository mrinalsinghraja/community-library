import "server-only";

/**
 * Typed application errors.
 *
 * Every one carries two messages: a technical one for the server log, and a
 * `friendlyMessage` that is safe to render to a nine-year-old. Nothing else is
 * ever shown to a user — no stack traces, no SQL, no entity ids.
 */

export type AppErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "NOT_FOUND"
  | "RULE_VIOLATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly friendlyMessage: string;
  readonly httpStatus: number;

  constructor(
    code: AppErrorCode,
    technicalMessage: string,
    friendlyMessage: string,
    httpStatus: number,
  ) {
    super(technicalMessage);
    this.name = new.target.name;
    this.code = code;
    this.friendlyMessage = friendlyMessage;
    this.httpStatus = httpStatus;
  }
}

export class NotAuthenticatedError extends AppError {
  constructor(technicalMessage = "No valid session") {
    super("NOT_AUTHENTICATED", technicalMessage, "Please sign in to keep going.", 401);
  }
}

export class NotAuthorizedError extends AppError {
  constructor(technicalMessage = "Permission denied") {
    super(
      "NOT_AUTHORIZED",
      technicalMessage,
      "That part of the library is not yours to open. Ask your librarian if you need it.",
      403,
    );
  }
}

/**
 * Used for genuinely missing things *and* for things the actor may not know
 * exist. Returning 404 rather than 403 for another member's record means the
 * response cannot be used to confirm that a member code is real.
 */
export class NotFoundError extends AppError {
  constructor(technicalMessage = "Not found") {
    super("NOT_FOUND", technicalMessage, "We could not find that.", 404);
  }
}

/** A library rule said no — max books, renewal limit, age range. */
export class RuleViolationError extends AppError {
  constructor(technicalMessage: string, friendlyMessage: string) {
    super("RULE_VIOLATION", technicalMessage, friendlyMessage, 422);
  }
}

/** Someone else got there first — typically a copy just borrowed. */
export class ConflictError extends AppError {
  constructor(technicalMessage: string, friendlyMessage = "Someone just got there first!") {
    super("CONFLICT", technicalMessage, friendlyMessage, 409);
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(technicalMessage: string, retryAfterSeconds: number) {
    super(
      "RATE_LIMITED",
      technicalMessage,
      "That was a lot of tries. Please wait a little and try again.",
      429,
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>, technicalMessage = "Validation failed") {
    super("VALIDATION", technicalMessage, "Some answers need a small fix.", 400);
    this.fieldErrors = fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Converts anything thrown into something safe to show. Unknown errors become a
 * generic message — an unexpected failure must never leak its internals to a
 * child's screen.
 */
export function toFriendlyMessage(error: unknown): string {
  if (isAppError(error)) return error.friendlyMessage;
  return "Oops! Something went wrong. Please ask your librarian for help.";
}
