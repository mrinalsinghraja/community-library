import "server-only";

import type { GuardianVerificationStrength, LibrarySettings, Prisma } from "@prisma/client";
import type { z } from "zod";

import {
  brandingSchema,
  EDITABLE_BRANDING_FIELDS,
  EDITABLE_SETTING_FIELDS,
  librarySettingsSchema,
  type BrandingInput,
  type LibrarySettingsInput,
} from "@/lib/settings-schema";
import { formatInTimezone } from "@/lib/dates";
import { requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { activeEmailProviderName, EmailService } from "@/server/lib/email";
import {
  NotFoundError,
  RateLimitedError,
  RuleViolationError,
  ValidationError,
} from "@/server/lib/errors";
import { checkActionThrottle, RATE_LIMITS, recordAction } from "@/server/lib/rate-limit";
import { scheduleMediaDeletion, storeBrandingImage } from "@/server/services/media-service";

/**
 * Library configuration.
 *
 * Everything a library decides about itself — how long a book is out for, how
 * many a child may hold, what the shelf is called, what colour the front door
 * is — lives in one row, and until this service existed the only way to change
 * any of it was an UPDATE typed at a production database holding children's
 * records. That is the whole reason this file exists.
 *
 * Three rules run through all of it:
 *
 *   1. **Only the allowlist is ever written.** Updates are assembled field by
 *      field from `EDITABLE_SETTING_FIELDS`, so a column that is not on that
 *      list cannot be written here however a form is tampered with. The dormant
 *      settings are not "hidden from the UI" — there is no code path.
 *   2. **A setting decides the future, never the past.** Nothing in this file
 *      touches a loan, a due date, a consent record or an audit row. Changing
 *      the loan period to twenty-one days changes what the next issue computes
 *      and nothing about a book already in a child's bag.
 *   3. **Every change is a change somebody made.** One audit row per update, in
 *      the same transaction, naming the actor and what moved.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Whether email can physically leave this deployment.
 *
 * `console` is the development transport: it captures messages to /dev/mail and
 * reaches nobody. Reminders may not be switched on against it — see
 * `setOverdueReminders`.
 */
export function emailCanReachAnybody(): boolean {
  return env.EMAIL_PROVIDER !== "console";
}

export interface ReminderCapability {
  enabled: boolean;
  canEnable: boolean;
  /** Present when `canEnable` is false. Written for a librarian, not a sysadmin. */
  blockedReason?: string;
}

export function reminderCapability(settings: LibrarySettings): ReminderCapability {
  const canEnable = emailCanReachAnybody();

  return {
    enabled: settings.overdueRemindersEnabled,
    canEnable,
    blockedReason: canEnable
      ? undefined
      : "Email reminders cannot be turned on until a real email service is set up for the library. Nothing sent from here would reach a family today.",
  };
}

/**
 * Configuration read straight from the database, for this actor's library.
 *
 * NOT `getCurrentLibrary()`, deliberately. That accessor is wrapped in React's
 * `cache()`, which is right for a page rendering twenty components off one
 * query and wrong for everything in this file: a server action and the render
 * that follows it share a request, so a screen that saved a change and then
 * re-read it through the cache would show the old value back to the person who
 * had just changed it. Configuration screens read the row.
 *
 * It also scopes by the actor's own library rather than "the first library",
 * so a write can never land on a tenant the session does not belong to.
 */
async function loadConfig(libraryId: string) {
  const library = await prisma.library.findUniqueOrThrow({
    where: { id: libraryId },
    include: { community: true, settings: true },
  });

  if (!library.settings) {
    throw new NotFoundError(`Library ${libraryId} has no library_settings row`);
  }

  return { library, community: library.community, settings: library.settings };
}

/** What the settings page needs to say about email, without naming a secret. */
export interface EmailDeliveryView {
  /** The transport in force: `brevo`, `resend`, `smtp`, or `refusing`. */
  provider: string;
  /** False when the deployment is configured to send nothing. */
  canSend: boolean;
  /** The signed-in administrator's own address, the only test recipient. */
  testRecipient: string | null;
  /** How the last few attempts went — the whole delivery log is not the point. */
  recentFailures: number;
  lastSentAt: Date | null;
}

export interface AdminSettingsView {
  libraryName: string;
  communityName: string;
  settings: LibrarySettings;
  reminders: ReminderCapability;
  email: EmailDeliveryView;
  /** Read-only: the wording lives in the code and changing it needs a release. */
  consentVersion: string;
  verificationVersion: string;
}

export async function getAdminSettings(): Promise<AdminSettingsView> {
  const actor = await requirePermission("settings.view");
  const { library, community, settings } = await loadConfig(actor.libraryId);

  return {
    libraryName: library.name,
    communityName: community.name,
    settings,
    reminders: reminderCapability(settings),
    email: await emailDeliveryView(actor.libraryId, actor.userId),
    consentVersion: settings.consentVersion,
    verificationVersion: settings.guardianVerificationVersion,
  };
}

async function emailDeliveryView(libraryId: string, userId: string): Promise<EmailDeliveryView> {
  const [me, recentFailures, lastSent] = await Promise.all([
    prisma.appUser.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.emailEvent.count({
      where: { libraryId, status: "FAILED", createdAt: { gte: daysAgo(7) } },
    }),
    prisma.emailEvent.findFirst({
      where: { libraryId, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);

  return {
    provider: activeEmailProviderName(),
    canSend: emailCanReachAnybody(),
    testRecipient: me?.email ?? null,
    recentFailures,
    lastSentAt: lastSent?.sentAt ?? null,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Sends one test message to the administrator's own address.
 *
 * This exists so that "can this library email anybody?" is a question with a
 * button rather than an experiment. The alternative was to approve a real
 * family and watch what happened, which spends a single-use activation token to
 * answer a question about configuration — and spends it on somebody who is
 * waiting for it.
 *
 * Three things keep it from becoming a way to send mail:
 *   • the recipient is not a parameter. It is whatever address is on the
 *     signed-in administrator's own account, so this cannot be pointed at a
 *     guardian, at a child, or at anybody outside the building.
 *   • it needs `settings.edit`, the same permission as every other switch on
 *     that page, and the service checks it rather than the button.
 *   • it is throttled per administrator, because a transport that is down stays
 *     down and pressing the button forty times only spends the daily allowance
 *     the families' activation links need.
 */
export async function sendEmailDeliveryTest(): Promise<{ ok: boolean; detail: string }> {
  const actor = await requirePermission("settings.edit");
  const { settings } = await loadConfig(actor.libraryId);

  const me = await prisma.appUser.findUnique({
    where: { id: actor.userId },
    select: { email: true },
  });

  if (!me?.email) {
    throw new RuleViolationError(
      `User ${actor.userId} has no email address to test with`,
      "Your own account has no email address, so there is nowhere to send the test. Add one first.",
    );
  }

  const throttle = await checkActionThrottle({
    bucket: EMAIL_TEST_BUCKET,
    subject: actor.userId,
    max: RATE_LIMITS.emailTestsMax,
    windowMinutes: RATE_LIMITS.emailTestWindowMinutes,
  });
  if (!throttle.allowed) {
    throw new RateLimitedError(
      `Email delivery tests exceeded for ${actor.userId}`,
      throttle.retryAfterSeconds,
    );
  }
  await recordAction(EMAIL_TEST_BUCKET, actor.userId);

  const result = await EmailService.sendDeliveryTest({
    to: me.email,
    requestedBy: actor.displayName,
    sentAt: formatInTimezone(new Date(), settings.timezone, "d MMM yyyy, h:mm a"),
  });

  if (result.ok) {
    return {
      ok: true,
      detail: `Sent to ${me.email} through ${result.provider}. If it does not arrive within a few minutes, check the spam folder.`,
    };
  }

  // The provider's own words. A librarian cannot act on "could not send", but
  // "sender_not_valid" is somebody forgetting to verify the From address.
  return {
    ok: false,
    detail: result.error
      ? `Nothing was sent. The mail service said: ${result.error}`
      : "Nothing was sent, and the mail service gave no reason.",
  };
}

const EMAIL_TEST_BUCKET = "email-delivery-test";

// ---------------------------------------------------------------------------
// Writing: the ordinary settings
// ---------------------------------------------------------------------------

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  // A schema-level refinement (ageMin <= ageMax) with no path would otherwise
  // produce an error object nothing on screen can render.
  if (Object.keys(fieldErrors).length === 0) {
    fieldErrors.form = parsed.error.issues[0]?.message ?? "That could not be saved.";
  }
  throw new ValidationError(fieldErrors, "Settings validation failed");
}

/** The fields that actually moved, so the audit row is readable a year later. */
function diffOf<T extends Record<string, unknown>>(
  before: Record<string, unknown>,
  after: T,
  fields: readonly (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
    }
  }
  return changes;
}

export async function updateLibrarySettings(raw: unknown): Promise<{ changed: string[] }> {
  const actor = await requirePermission("settings.edit");
  const input: LibrarySettingsInput = parseOrThrow(librarySettingsSchema, raw);
  const { library, settings } = await loadConfig(actor.libraryId);

  // Built from the allowlist, one field at a time. The parsed input is never
  // spread into the update: a field that is not on the list has no way in.
  const data: Prisma.LibrarySettingsUpdateInput = {};
  for (const field of EDITABLE_SETTING_FIELDS) {
    (data as Record<string, unknown>)[field] = input[field];
  }

  const changes = diffOf(settings as unknown as Record<string, unknown>, input, [
    ...EDITABLE_SETTING_FIELDS,
  ]);
  const nameChanged = library.name !== input.libraryName;
  if (nameChanged) {
    changes.libraryName = { from: library.name, to: input.libraryName };
  }

  if (Object.keys(changes).length === 0) return { changed: [] };

  await prisma.$transaction(async (tx) => {
    if (nameChanged) {
      await tx.library.update({ where: { id: library.id }, data: { name: input.libraryName } });
    }

    await tx.librarySettings.update({
      where: { libraryId: library.id },
      data: { ...data, updatedById: actor.userId },
    });

    await recordAudit(tx, {
      libraryId: library.id,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "library_settings",
      entityId: library.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { changes },
    });
  });

  return { changed: Object.keys(changes) };
}

// ---------------------------------------------------------------------------
// Writing: branding
// ---------------------------------------------------------------------------

export async function updateBranding(raw: unknown): Promise<{ changed: string[] }> {
  const actor = await requirePermission("branding.edit");
  const input: BrandingInput = parseOrThrow(brandingSchema, raw);
  const { library, settings } = await loadConfig(actor.libraryId);

  // An emptied box means "the library has no phone number", not "". The colour
  // is the exception: there is always one, and the validator has already proved
  // this is a hex value.
  const blankToNull = (value: string | undefined) => (value === undefined || value === "" ? null : value);

  const data = {
    primaryColor: input.primaryColor,
    welcomeMessage: blankToNull(input.welcomeMessage),
    rulesMarkdown: blankToNull(input.rulesMarkdown),
    donationPolicyMarkdown: blankToNull(input.donationPolicyMarkdown),
    contactEmail: blankToNull(input.contactEmail),
    contactPhone: blankToNull(input.contactPhone),
  } satisfies Record<(typeof EDITABLE_BRANDING_FIELDS)[number], string | null>;

  const changes = diffOf(
    settings as unknown as Record<string, unknown>,
    data as Record<string, unknown>,
    [...EDITABLE_BRANDING_FIELDS],
  );

  if (Object.keys(changes).length === 0) return { changed: [] };

  await prisma.$transaction(async (tx) => {
    await tx.librarySettings.update({
      where: { libraryId: library.id },
      data: { ...data, updatedById: actor.userId },
    });

    await recordAudit(tx, {
      libraryId: library.id,
      action: AUDIT_ACTIONS.BRANDING_UPDATED,
      entityType: "library_settings",
      entityId: library.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // Field names, not eight thousand characters of rules text.
      metadata: { changed: Object.keys(changes) },
    });
  });

  return { changed: Object.keys(changes) };
}

/**
 * Replaces the library's logo.
 *
 * The old object is scheduled for deletion in the same transaction that stops
 * pointing at it, so the sweeper collects the bytes and no orphan is left
 * behind. See docs/MEDIA.md — the row is the ledger.
 */
export async function updateLibraryLogo(params: {
  bytes: Uint8Array;
  declaredMimeType?: string;
  originalFilename?: string;
}): Promise<{ logoUrl: string }> {
  const actor = await requirePermission("branding.edit");
  const { library, settings } = await loadConfig(actor.libraryId);

  const stored = await storeBrandingImage({
    libraryId: library.id,
    bytes: params.bytes,
    declaredMimeType: params.declaredMimeType,
    originalFilename: params.originalFilename,
    uploadedById: actor.userId,
  });

  // Served through the media route in every environment, so there is one
  // authorization decision and one URL shape, dev and production alike.
  const logoUrl = `/api/media/${stored.mediaId}`;
  const previous = extractMediaId(settings.logoUrl);

  await prisma.$transaction(async (tx) => {
    await tx.mediaObject.update({
      where: { id: stored.mediaId },
      data: { pendingDeletionAt: null },
    });
    await tx.librarySettings.update({
      where: { libraryId: library.id },
      data: { logoUrl, updatedById: actor.userId },
    });
    if (previous) await scheduleMediaDeletion(tx, previous);

    await recordAudit(tx, {
      libraryId: library.id,
      action: AUDIT_ACTIONS.BRANDING_UPDATED,
      entityType: "library_settings",
      entityId: library.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { changed: ["logo"], replaced: Boolean(previous) },
    });
  });

  return { logoUrl };
}

export async function removeLibraryLogo(): Promise<void> {
  const actor = await requirePermission("branding.edit");
  const { library, settings } = await loadConfig(actor.libraryId);

  const previous = extractMediaId(settings.logoUrl);
  if (!settings.logoUrl) return;

  await prisma.$transaction(async (tx) => {
    await tx.librarySettings.update({
      where: { libraryId: library.id },
      data: { logoUrl: null, updatedById: actor.userId },
    });
    if (previous) await scheduleMediaDeletion(tx, previous);

    await recordAudit(tx, {
      libraryId: library.id,
      action: AUDIT_ACTIONS.BRANDING_UPDATED,
      entityType: "library_settings",
      entityId: library.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { changed: ["logo"], removed: true },
    });
  });
}

/** `/api/media/<uuid>` → `<uuid>`. Any other shape is somebody else's URL. */
function extractMediaId(url: string | null): string | null {
  if (!url) return null;
  const match = /^\/api\/media\/([0-9a-fA-F-]{16,})$/.exec(url);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Writing: guardian verification
// ---------------------------------------------------------------------------

/**
 * The strengths a Super Admin may require.
 *
 * `NONE` is missing because "require nothing at all" should not be one tap away
 * on a screen about children's accounts; a library that genuinely wants it can
 * be helped to set it deliberately. `IDENTITY_PROVIDER` is missing because
 * nothing implements it — requiring it would make every approval impossible,
 * which is a fail-closed the software should not let anyone walk into.
 */
export const SELECTABLE_VERIFICATION_STRENGTHS: readonly GuardianVerificationStrength[] = [
  "SELF_DECLARED",
  "EMAIL_CONFIRMED",
  "STAFF_VERIFIED",
];

export async function updateVerificationRequirement(params: {
  strength: string;
  confirmed: boolean;
}): Promise<{ changed: boolean }> {
  const actor = await requirePermission("settings.edit");
  const { library, settings } = await loadConfig(actor.libraryId);

  const strength = params.strength as GuardianVerificationStrength;
  if (!SELECTABLE_VERIFICATION_STRENGTHS.includes(strength)) {
    throw new ValidationError(
      { requiredGuardianVerification: "Choose one of the options offered." },
      `Refused verification strength ${params.strength}`,
    );
  }

  if (strength === settings.requiredGuardianVerification) return { changed: false };

  // The confirmation is the point of the control, not decoration: this decides
  // what evidence the library holds that an adult approving a child's account
  // is that child's guardian.
  if (!params.confirmed) {
    throw new ValidationError(
      { confirm: "Tick the box to confirm you mean to change how guardians are verified." },
      "Verification strength change without confirmation",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.librarySettings.update({
      where: { libraryId: library.id },
      data: { requiredGuardianVerification: strength, updatedById: actor.userId },
    });

    await recordAudit(tx, {
      libraryId: library.id,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "library_settings",
      entityId: library.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        changes: {
          requiredGuardianVerification: {
            from: settings.requiredGuardianVerification,
            to: strength,
          },
        },
      },
    });
  });

  return { changed: true };
}

// ---------------------------------------------------------------------------
// Writing: the reminder switch
// ---------------------------------------------------------------------------

/**
 * Turns overdue and due-soon reminders on or off.
 *
 * Enabling is refused outright while the deployment's email provider is
 * `console`. Not warned about — refused. A librarian who ticked a box and was
 * told "saved" would believe families are being written to, and nothing would
 * have left the building. Turning reminders OFF is always allowed: silence is
 * never the dangerous direction.
 */
export async function setOverdueReminders(enabled: boolean): Promise<void> {
  const actor = await requirePermission("settings.edit");
  const { library, settings } = await loadConfig(actor.libraryId);

  if (enabled && !emailCanReachAnybody()) {
    throw new RuleViolationError(
      `Refused to enable reminders while EMAIL_PROVIDER=${env.EMAIL_PROVIDER}`,
      "Email reminders cannot be turned on until a real email service is set up for the library.",
    );
  }

  if (settings.overdueRemindersEnabled === enabled) return;

  await prisma.$transaction(async (tx) => {
    await tx.librarySettings.update({
      where: { libraryId: library.id },
      data: { overdueRemindersEnabled: enabled, updatedById: actor.userId },
    });

    await recordAudit(tx, {
      libraryId: library.id,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "library_settings",
      entityId: library.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        changes: {
          overdueRemindersEnabled: { from: settings.overdueRemindersEnabled, to: enabled },
        },
      },
    });
  });
}
