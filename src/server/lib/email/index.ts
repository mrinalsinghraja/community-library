import "server-only";

import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { getCurrentLibrary } from "@/server/lib/settings";
import { createEmailProvider } from "@/server/lib/email/providers";
import * as templates from "@/server/lib/email/templates";
import { TEMPLATE_IDS } from "@/server/lib/email/templates";
import type { EmailContext, EmailMessage, EmailProvider } from "@/server/lib/email/types";

/**
 * EmailService — the only thing services call.
 *
 * Guarantees:
 *   • Every attempt writes an `email_event` row, so "did the guardian ever get
 *     the activation link?" is answerable without leaving the admin UI.
 *   • A delivery failure never throws into the caller. Approving a registration
 *     must not roll back because a mail server was briefly unreachable — the
 *     failure is recorded and the librarian can reissue the link.
 *   • Nothing that could authenticate someone is ever logged: not the body, not
 *     the link, not a token.
 */

let cachedProvider: EmailProvider | null = null;

function provider(): EmailProvider {
  cachedProvider ??= createEmailProvider();
  return cachedProvider;
}

/** Test seam — lets a test assert on what would have been sent. */
export function __setEmailProviderForTests(next: EmailProvider | null): void {
  cachedProvider = next;
}

async function context(): Promise<EmailContext & { libraryId: string }> {
  const { library, community, settings } = await getCurrentLibrary();
  return {
    libraryId: library.id,
    libraryName: library.name,
    communityName: community.name,
    appUrl: env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""),
    contactEmail: settings.contactEmail,
  };
}

interface DispatchOptions {
  to: string;
  template: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

interface DispatchOutcome {
  ok: boolean;
  /** The `email_event` row. Callers that need to point at the attempt keep it. */
  eventId: string;
}

async function dispatchWithEvent(
  message: EmailMessage,
  libraryId: string,
  options: DispatchOptions,
): Promise<DispatchOutcome> {
  const event = await prisma.emailEvent.create({
    data: {
      libraryId,
      recipient: options.to,
      template: options.template,
      subject: message.subject,
      status: "QUEUED",
      relatedEntityType: options.relatedEntityType ?? null,
      relatedEntityId: options.relatedEntityId ?? null,
    },
  });

  const result = await provider().send(message);

  await prisma.emailEvent.update({
    where: { id: event.id },
    data: {
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.providerMessageId ?? null,
      // Provider error text only — never the message body, which holds the link.
      error: result.error ?? null,
      sentAt: result.ok ? new Date() : null,
    },
  });

  if (!result.ok) {
    console.error(
      `[email] delivery failed template=${options.template} event=${event.id}: ${result.error}`,
    );
  }

  return { ok: result.ok, eventId: event.id };
}

/** The common case: did it go? */
async function dispatch(
  message: EmailMessage,
  libraryId: string,
  options: DispatchOptions,
): Promise<boolean> {
  return (await dispatchWithEvent(message, libraryId, options)).ok;
}

export const EmailService = {
  async sendRegistrationReceived(params: {
    to: string;
    guardianName: string;
    childName: string;
    registrationId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.registrationReceived(ctx, params);

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.REGISTRATION_RECEIVED, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.REGISTRATION_RECEIVED,
        relatedEntityType: "registration_request",
        relatedEntityId: params.registrationId,
      },
    );
  },

  /**
   * Asks the guardian to confirm it was really them. Sent only when the library
   * requires EMAIL_CONFIRMED verification or stronger.
   */
  async sendGuardianVerification(params: {
    to: string;
    guardianName: string;
    childName: string;
    verificationToken: string;
    expiresInHours: number;
    registrationId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.guardianVerification(ctx, {
      guardianName: params.guardianName,
      childName: params.childName,
      // Same rule as every other link: the raw token lives in this email and
      // nowhere else.
      verificationUrl: `${ctx.appUrl}/verify/${params.verificationToken}`,
      expiresInHours: params.expiresInHours,
    });

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.GUARDIAN_VERIFICATION, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.GUARDIAN_VERIFICATION,
        relatedEntityType: "registration_request",
        relatedEntityId: params.registrationId,
      },
    );
  },

  /** Registration approved *and* the account is ready — one email, one action. */
  async sendActivation(params: {
    to: string;
    guardianName: string;
    childName: string;
    memberCode: string;
    activationToken: string;
    expiresInDays: number;
    memberUserId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.activation(ctx, {
      guardianName: params.guardianName,
      childName: params.childName,
      memberCode: params.memberCode,
      // The token appears here and nowhere else — not in the audit log, not in
      // the delivery log, not in any console output.
      activationUrl: `${ctx.appUrl}/activate/${params.activationToken}`,
      expiresInDays: params.expiresInDays,
    });

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.ACTIVATION, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.ACTIVATION,
        relatedEntityType: "app_user",
        relatedEntityId: params.memberUserId,
      },
    );
  },

  /** A new librarian, not a guardian — its own template and its own wording. */
  async sendStaffInvitation(params: {
    to: string;
    name: string;
    roleName: string;
    activationToken: string;
    expiresInDays: number;
    userId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.staffInvitation(ctx, {
      name: params.name,
      roleName: params.roleName,
      activationUrl: `${ctx.appUrl}/activate/${params.activationToken}`,
      expiresInDays: params.expiresInDays,
    });

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.STAFF_INVITATION, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.STAFF_INVITATION,
        relatedEntityType: "app_user",
        relatedEntityId: params.userId,
      },
    );
  },

  async sendRegistrationRejected(params: {
    to: string;
    guardianName: string;
    childName: string;
    registrationId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.registrationRejected(ctx, params);

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.REGISTRATION_REJECTED, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.REGISTRATION_REJECTED,
        relatedEntityType: "registration_request",
        relatedEntityId: params.registrationId,
      },
    );
  },

  async sendPasswordReset(params: {
    to: string;
    childName: string;
    resetToken: string;
    expiresInHours: number;
    userId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.passwordReset(ctx, {
      childName: params.childName,
      resetUrl: `${ctx.appUrl}/reset/${params.resetToken}`,
      expiresInHours: params.expiresInHours,
    });

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.PASSWORD_RESET, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.PASSWORD_RESET,
        relatedEntityType: "app_user",
        relatedEntityId: params.userId,
      },
    );
  },

  async sendPasswordChanged(params: {
    to: string;
    childName: string;
    userId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.passwordChanged(ctx, { childName: params.childName });

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.PASSWORD_CHANGED, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.PASSWORD_CHANGED,
        relatedEntityType: "app_user",
        relatedEntityId: params.userId,
      },
    );
  },

  async sendAccountSuspended(params: {
    to: string;
    childName: string;
    userId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.accountSuspended(ctx, { childName: params.childName });

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.ACCOUNT_SUSPENDED, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.ACCOUNT_SUSPENDED,
        relatedEntityType: "app_user",
        relatedEntityId: params.userId,
      },
    );
  },

  async sendAccountReactivated(params: {
    to: string;
    childName: string;
    userId: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.accountReactivated(ctx, { childName: params.childName });

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.ACCOUNT_REACTIVATED, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: TEMPLATE_IDS.ACCOUNT_REACTIVATED,
        relatedEntityType: "app_user",
        relatedEntityId: params.userId,
      },
    );
  },

  /**
   * A due-soon reminder or an overdue nudge, to the guardian.
   *
   * Returns the delivery record's id as well as the outcome, because the daily
   * job records which attempt each reminder was — the `loan_notification` row
   * says an occurrence was claimed, and this says what happened to it.
   *
   * The loan id goes on the delivery record as the related entity, so "which
   * book was this about?" is answerable later without the message body.
   */
  async sendLoanReminder(params: {
    to: string;
    subject: string;
    sentence: string;
    childName: string;
    title: string;
    copyCode: string;
    openingNote?: string | null;
    template: typeof TEMPLATE_IDS.LOAN_DUE_SOON | typeof TEMPLATE_IDS.LOAN_OVERDUE;
    loanId: string;
  }): Promise<{ ok: boolean; eventId: string }> {
    const ctx = await context();
    const rendered = templates.loanReminder(ctx, params);

    return dispatchWithEvent(
      { to: params.to, template: params.template, ...rendered },
      ctx.libraryId,
      {
        to: params.to,
        template: params.template,
        relatedEntityType: "loan",
        relatedEntityId: params.loanId,
      },
    );
  },

  async sendImportantNotification(params: {
    to: string;
    heading: string;
    body: string;
  }): Promise<boolean> {
    const ctx = await context();
    const rendered = templates.importantNotification(ctx, params);

    return dispatch(
      { to: params.to, template: TEMPLATE_IDS.IMPORTANT_NOTIFICATION, ...rendered },
      ctx.libraryId,
      { to: params.to, template: TEMPLATE_IDS.IMPORTANT_NOTIFICATION },
    );
  },

  /**
   * Proves the transport, to the administrator who asked.
   *
   * Returns the provider's own reason on failure rather than a boolean, because
   * this is the one send whose whole purpose is to answer "why not?" — a wrong
   * key, an unverified sender address and a blocked port are three different
   * problems with three different fixes, and a librarian staring at "could not
   * send" can act on none of them. The reason is provider text only; the
   * dispatcher has already refused to let a message body near a log.
   */
  async sendDeliveryTest(params: {
    to: string;
    requestedBy: string;
    sentAt: string;
  }): Promise<{ ok: boolean; error?: string; provider: string }> {
    const ctx = await context();
    const rendered = templates.deliveryTest(ctx, {
      requestedBy: params.requestedBy,
      sentAt: params.sentAt,
    });

    const outcome = await dispatchWithEvent(
      { to: params.to, template: TEMPLATE_IDS.DELIVERY_TEST, ...rendered },
      ctx.libraryId,
      { to: params.to, template: TEMPLATE_IDS.DELIVERY_TEST },
    );

    if (outcome.ok) return { ok: true, provider: provider().name };

    const event = await prisma.emailEvent.findUnique({
      where: { id: outcome.eventId },
      select: { error: true },
    });
    return { ok: false, error: event?.error ?? undefined, provider: provider().name };
  },
};

/** Which transport this deployment is actually using. Shown on the settings page. */
export function activeEmailProviderName(): string {
  return provider().name;
}

export { TEMPLATE_IDS };
export type { EmailProvider, EmailMessage } from "@/server/lib/email/types";
