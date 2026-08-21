import "server-only";

import type { EmailContext, RenderedTemplate } from "@/server/lib/email/types";

/**
 * Email templates.
 *
 * Tone: written to the parent or guardian, not to the child. A six-year-old is
 * not responsible for account security, and an email that talks to them as if
 * they were would be both confusing and wrong.
 *
 * Rules, without exception:
 *   • no password is ever included, not even a temporary one
 *   • the only secret that appears is a single-use, time-limited link
 *   • nothing about any other family appears in any message
 */

/** Escapes interpolated values. Names come from a form and end up in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The library's mark, at the head of every message.
 *
 * Three constraints shape how it is done.
 *
 * **It is a static file, not the branding upload.** `settings.logoUrl` points at
 * `/api/media/[id]`, which is authorization-gated per request — an inbox cannot
 * authenticate, so that image would be a permanent broken box. This is the same
 * drawn mark the site shows, served from `public/` with no token in the URL, so
 * fetching it says nothing about who opened the message.
 *
 * **It carries the library's name as `alt`, not an empty string.** Blocking
 * external images is the default in a great many inboxes and the setting many
 * people never change, so "images off" is a normal way to read this email
 * rather than an edge case. An empty `alt` renders as a bare grey box, which
 * looks like the library sent something broken; the name renders as the name.
 * The slight redundancy for a screen reader is a fair price for that.
 *
 * **It is a 16KB copy, not the 160KB one.** These go to parents on phones, on
 * mobile data, in bursts.
 *
 * The tag is one line on purpose. Email sanitisers rewrite markup aggressively
 * and a tag broken across lines is a needless thing to hand them.
 */
function masthead(context: EmailContext): string {
  const src = `${escapeHtml(context.appUrl)}/brand/library-mark-email.png`;
  const alt = escapeHtml(context.libraryName);

  return `<img src="${src}" width="59" height="64" alt="${alt}" style="display:block;border:0;outline:none;text-decoration:none;margin:0 0 12px;max-width:59px;" />`;
}

function layout(context: EmailContext, heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#FDF8F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2B2118;line-height:1.6;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:32px;">
    ${masthead(context)}
    <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1F6F5C;letter-spacing:0.02em;">
      ${escapeHtml(context.libraryName)}
    </p>
    <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#2B2118;">${escapeHtml(heading)}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #E3D9C9;margin:28px 0 16px;" />
    <p style="margin:0;font-size:13px;color:#5C4F42;">
      ${escapeHtml(context.libraryName)} is a free library run by and for the
      ${escapeHtml(context.communityName)} community.
      ${context.contactEmail ? `Questions? Write to ${escapeHtml(context.contactEmail)}.` : ""}
    </p>
  </div>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#1F6F5C;color:#FFFFFF;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px;">${escapeHtml(label)}</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#5C4F42;">
    If the button does not work, copy this link into your browser:<br />
    <span style="word-break:break-all;">${escapeHtml(href)}</span>
  </p>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;">${escapeHtml(text)}</p>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const TEMPLATE_IDS = {
  REGISTRATION_RECEIVED: "registration_received",
  REGISTRATION_APPROVED: "registration_approved",
  REGISTRATION_REJECTED: "registration_rejected",
  ACTIVATION: "activation",
  GUARDIAN_VERIFICATION: "guardian_verification",
  STAFF_INVITATION: "staff_invitation",
  PASSWORD_RESET: "password_reset",
  PASSWORD_CHANGED: "password_changed",
  ACCOUNT_SUSPENDED: "account_suspended",
  ACCOUNT_REACTIVATED: "account_reactivated",
  IMPORTANT_NOTIFICATION: "important_notification",
  LOAN_DUE_SOON: "loan_due_soon",
  LOAN_OVERDUE: "loan_overdue",
  DELIVERY_TEST: "delivery_test",
} as const;

/**
 * The only email that exists for the library's own sake.
 *
 * Sent by an administrator to their own address to find out whether mail leaves
 * this deployment at all. It has to exist, because the alternative way to test
 * the transport is to issue somebody a real activation link and watch — which
 * spends a single-use token on a question about configuration, and spends it on
 * a family who is waiting for it.
 *
 * It carries no link, no token and nothing about any member.
 */
export function deliveryTest(
  context: EmailContext,
  params: { requestedBy: string; sentAt: string },
): RenderedTemplate {
  const heading = "Email is working";
  const body =
    paragraph(`Hello ${params.requestedBy},`) +
    paragraph(
      `If you are reading this, ${context.libraryName} can send email. Activation links, password resets and reminders will reach families at the address they gave.`,
    ) +
    paragraph(`Sent from the settings page at ${params.sentAt}.`) +
    paragraph("Nobody else was written to. This message contains no link and no account details.");

  return {
    subject: `${context.libraryName}: email delivery test`,
    html: layout(context, heading, body),
    text: [
      `Hello ${params.requestedBy},`,
      "",
      `If you are reading this, ${context.libraryName} can send email.`,
      "",
      `Sent from the settings page at ${params.sentAt}.`,
      "",
      "Nobody else was written to. This message contains no link and no account details.",
    ].join("\n"),
  };
}

export function registrationReceived(
  context: EmailContext,
  params: { guardianName: string; childName: string },
): RenderedTemplate {
  const heading = "We have your library registration";
  const body =
    paragraph(`Dear ${params.guardianName},`) +
    paragraph(
      `Thank you for registering ${params.childName} for ${context.libraryName}. Our librarian will look at the details and get back to you shortly.`,
    ) +
    paragraph(
      "There is nothing else you need to do right now. Membership is free, and it always will be.",
    );

  return {
    subject: `We have your registration for ${params.childName}`,
    html: layout(context, heading, body),
    text: [
      `Dear ${params.guardianName},`,
      "",
      `Thank you for registering ${params.childName} for ${context.libraryName}. Our librarian will look at the details and get back to you shortly.`,
      "",
      "There is nothing else you need to do right now. Membership is free, and it always will be.",
    ].join("\n"),
  };
}

/**
 * The most important email in the system. If this does not arrive, a family
 * cannot join — which is why delivery is logged and a librarian can reissue
 * the link from the desk.
 */
export function activation(
  context: EmailContext,
  params: {
    guardianName: string;
    childName: string;
    memberCode: string;
    activationUrl: string;
    expiresInDays: number;
  },
): RenderedTemplate {
  const heading = `${params.childName}'s library account is ready`;
  const body =
    paragraph(`Dear ${params.guardianName},`) +
    paragraph(
      `Good news — ${params.childName} is now a member of ${context.libraryName}. Their library card number is ${params.memberCode}.`,
    ) +
    paragraph(
      "One last step: please help them choose a secret word for signing in. Use the button below.",
    ) +
    button(params.activationUrl, "Set up the account") +
    paragraph(
      `This link works once and expires in ${params.expiresInDays} days. If it stops working, just ask the librarian for a fresh one.`,
    ) +
    paragraph(
      "Please choose the secret word together with your child, and keep it somewhere safe. Nobody at the library can see it — if it is forgotten, we send you a new link rather than telling you the old one.",
    );

  return {
    subject: `${params.childName}'s library account is ready`,
    html: layout(context, heading, body),
    text: [
      `Dear ${params.guardianName},`,
      "",
      `${params.childName} is now a member of ${context.libraryName}. Their library card number is ${params.memberCode}.`,
      "",
      "Please help them choose a secret word for signing in:",
      params.activationUrl,
      "",
      `This link works once and expires in ${params.expiresInDays} days.`,
      "",
      "Nobody at the library can see the secret word. If it is forgotten, we send a new link rather than telling you the old one.",
    ].join("\n"),
  };
}

/**
 * Guardian verification — a different question from consent, and a different
 * email from activation.
 *
 * Sent only when the library is configured to require an emailed confirmation.
 * Its whole job is to establish that the person who filled in the form can read
 * the inbox they gave us. It carries no library card number, no date of birth
 * and nothing about the child beyond their first name, because until it is
 * answered we do not yet know we are writing to the right adult.
 */
export function guardianVerification(
  context: EmailContext,
  params: {
    guardianName: string;
    childName: string;
    verificationUrl: string;
    expiresInHours: number;
  },
): RenderedTemplate {
  const heading = "Please confirm you are the parent or guardian";
  const body =
    paragraph(`Dear ${params.guardianName},`) +
    paragraph(
      `Somebody registered ${params.childName} for ${context.libraryName} and gave this email address as the parent or guardian's. Before we set anything up, we would like to check that it was you.`,
    ) +
    button(params.verificationUrl, "Yes, that was me") +
    paragraph(
      `This link works once and expires in ${params.expiresInHours} hours. Nothing happens to the registration until you use it.`,
    ) +
    paragraph(
      "If you were not expecting this, you do not need to do anything at all — please just let the librarian know, and we will close the registration.",
    );

  return {
    subject: `Please confirm ${params.childName}'s library registration`,
    html: layout(context, heading, body),
    text: [
      `Dear ${params.guardianName},`,
      "",
      `Somebody registered ${params.childName} for ${context.libraryName} and gave this email address as the parent or guardian's. Before we set anything up, we would like to check that it was you.`,
      "",
      "Confirm here:",
      params.verificationUrl,
      "",
      `This link works once and expires in ${params.expiresInHours} hours.`,
      "",
      "If you were not expecting this, you do not need to do anything — please let the librarian know and we will close the registration.",
    ].join("\n"),
  };
}

/**
 * Staff invitation. A separate template rather than a reused activation email:
 * a new librarian is not a child's guardian, and telling them "your child is now
 * a member" would be nonsense.
 */
export function staffInvitation(
  context: EmailContext,
  params: { name: string; roleName: string; activationUrl: string; expiresInDays: number },
): RenderedTemplate {
  const heading = `You have been added to ${context.libraryName}`;
  const body =
    paragraph(`Hello ${params.name},`) +
    paragraph(
      `You have been set up as ${params.roleName} for ${context.libraryName}. Use the button below to choose your password and sign in.`,
    ) +
    button(params.activationUrl, "Set up your account") +
    paragraph(`This link works once and expires in ${params.expiresInDays} days.`) +
    paragraph(
      "You will be helping look after children's personal information, so please choose a strong password and do not share it with anyone.",
    );

  return {
    subject: `Your ${context.libraryName} account`,
    html: layout(context, heading, body),
    text: [
      `Hello ${params.name},`,
      "",
      `You have been set up as ${params.roleName} for ${context.libraryName}.`,
      "",
      "Choose your password here:",
      params.activationUrl,
      "",
      `This link works once and expires in ${params.expiresInDays} days.`,
      "",
      "You will be helping look after children's personal information, so please choose a strong password and do not share it.",
    ].join("\n"),
  };
}

export function registrationRejected(
  context: EmailContext,
  params: { guardianName: string; childName: string },
): RenderedTemplate {
  const heading = "About your library registration";
  // Deliberately soft, and deliberately without the internal reason. The
  // librarian's note is for the library, not for the family.
  const body =
    paragraph(`Dear ${params.guardianName},`) +
    paragraph(
      `Thank you for your interest in ${context.libraryName}. We are not able to set up an account for ${params.childName} from this registration.`,
    ) +
    paragraph(
      "Please do come and have a word with the librarian at the library — it is usually something small that we can sort out together.",
    );

  return {
    subject: `About ${params.childName}'s library registration`,
    html: layout(context, heading, body),
    text: [
      `Dear ${params.guardianName},`,
      "",
      `Thank you for your interest in ${context.libraryName}. We are not able to set up an account for ${params.childName} from this registration.`,
      "",
      "Please come and have a word with the librarian at the library — it is usually something small we can sort out together.",
    ].join("\n"),
  };
}

export function passwordReset(
  context: EmailContext,
  params: { childName: string; resetUrl: string; expiresInHours: number },
): RenderedTemplate {
  const heading = "Setting a new secret word";
  const body =
    paragraph(
      `Someone asked to reset the sign-in details for ${params.childName}'s account at ${context.libraryName}.`,
    ) +
    button(params.resetUrl, "Choose a new secret word") +
    paragraph(
      `This link works once and expires in ${params.expiresInHours} hours.`,
    ) +
    paragraph(
      "If you did not ask for this, you can ignore this email — nothing has changed, and the old secret word still works.",
    );

  return {
    subject: `Setting a new secret word for ${params.childName}`,
    html: layout(context, heading, body),
    text: [
      `Someone asked to reset the sign-in details for ${params.childName}'s account at ${context.libraryName}.`,
      "",
      params.resetUrl,
      "",
      `This link works once and expires in ${params.expiresInHours} hours.`,
      "",
      "If you did not ask for this, you can ignore this email. Nothing has changed.",
    ].join("\n"),
  };
}

export function passwordChanged(
  context: EmailContext,
  params: { childName: string },
): RenderedTemplate {
  const heading = "The secret word was changed";
  const body =
    paragraph(
      `The sign-in details for ${params.childName}'s account at ${context.libraryName} were changed just now, and every other device has been signed out.`,
    ) +
    paragraph(
      "If this was not you or your child, please tell the librarian as soon as you can.",
    );

  return {
    subject: `${params.childName}'s library sign-in was changed`,
    html: layout(context, heading, body),
    text: [
      `The sign-in details for ${params.childName}'s account at ${context.libraryName} were changed just now, and every other device has been signed out.`,
      "",
      "If this was not you or your child, please tell the librarian as soon as you can.",
    ].join("\n"),
  };
}

export function accountSuspended(
  context: EmailContext,
  params: { childName: string },
): RenderedTemplate {
  const heading = "Library account paused";
  // No internal reason. The librarian's note stays inside the library.
  const body =
    paragraph(
      `${params.childName}'s account at ${context.libraryName} has been paused for the moment, so they will not be able to sign in.`,
    ) +
    paragraph(
      "Please have a word with the librarian at the library and we will get it sorted.",
    );

  return {
    subject: `${params.childName}'s library account has been paused`,
    html: layout(context, heading, body),
    text: [
      `${params.childName}'s account at ${context.libraryName} has been paused for the moment, so they will not be able to sign in.`,
      "",
      "Please have a word with the librarian at the library and we will get it sorted.",
    ].join("\n"),
  };
}

export function accountReactivated(
  context: EmailContext,
  params: { childName: string },
): RenderedTemplate {
  const heading = "Library account is active again";
  const body =
    paragraph(
      `Good news — ${params.childName}'s account at ${context.libraryName} is active again. They can sign in as usual.`,
    ) + paragraph("Happy reading!");

  return {
    subject: `${params.childName}'s library account is active again`,
    html: layout(context, heading, body),
    text: [
      `${params.childName}'s account at ${context.libraryName} is active again. They can sign in as usual.`,
      "",
      "Happy reading!",
    ].join("\n"),
  };
}

/**
 * A book is due back soon, or was due back and has not arrived.
 *
 * One template for both, because they are the same message at different points
 * on the same timeline and splitting them would invite the second one to grow a
 * sterner voice. What changes is the sentence, which is composed in
 * `src/lib/notifications.ts` where the tone rules live and where a test can
 * read it.
 *
 * What this message deliberately does NOT contain:
 *
 *   • any other child, any other family, any other book
 *   • a count of days late, or any number a family could feel scored by
 *   • a consequence, because there is none — this library charges no fines
 *   • a link that does anything. There is no action to take on a screen; the
 *     book comes back to a room, not to a URL, and a reminder carrying a login
 *     link would be one more link for somebody to phish.
 */
export function loanReminder(
  context: EmailContext,
  params: {
    subject: string;
    /** The whole message, already worded by `reminderSentence`. */
    sentence: string;
    childName: string;
    title: string;
    copyCode: string;
    /** Optional, and only if the library published one. */
    openingNote?: string | null;
  },
): RenderedTemplate {
  const heading = "A library book to come home";

  const detail = `${params.title} (${params.copyCode})`;
  const closing =
    "There is nothing to pay and nothing to do online — just pop it in the bag on the next library day.";

  const body =
    paragraph(params.sentence) +
    paragraph(`The book is ${detail}.`) +
    paragraph(closing) +
    (params.openingNote ? paragraph(params.openingNote) : "");

  return {
    subject: params.subject,
    html: layout(context, heading, body),
    text: [
      params.sentence,
      "",
      `The book is ${detail}.`,
      "",
      closing,
      ...(params.openingNote ? ["", params.openingNote] : []),
    ].join("\n"),
  };
}

export function importantNotification(
  context: EmailContext,
  params: { heading: string; body: string },
): RenderedTemplate {
  return {
    subject: `${params.heading} — ${context.libraryName}`,
    html: layout(context, params.heading, paragraph(params.body)),
    text: [params.heading, "", params.body].join("\n"),
  };
}
