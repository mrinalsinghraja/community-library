import "server-only";

import type { EmailContext, InlineImage, RenderedTemplate } from "@/server/lib/email/types";

/** A rendered message plus the pictures that travel inside it. */
export type RenderedTemplateWithImages = RenderedTemplate & { inlineImages: InlineImage[] };

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
 *
 * The filename is versioned, and `/brand/*` is served `immutable` with a year's
 * cache by vercel.json. Both are for Gmail's image proxy rather than for
 * browsers: it fetches the image on the recipient's behalf and caches the
 * result per URL, it wants a response it is allowed to cache -- Vercel's static
 * default of `max-age=0, must-revalidate` is not -- and once it has recorded a
 * failure against a URL it keeps serving that failure. A new filename is the
 * only way to ask it again.
 */
function masthead(context: EmailContext): string {
  const src = `${escapeHtml(context.appUrl)}/brand/library-mark-email-v2.png`;
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

function subheading(text: string): string {
  return `<h2 style="margin:26px 0 10px;font-size:17px;line-height:1.35;color:#1F6F5C;">${escapeHtml(text)}</h2>`;
}

function steps(items: string[]): string {
  const rows = items
    .map((item) => `<li style="margin:0 0 8px;">${escapeHtml(item)}</li>`)
    .join("");
  return `<ol style="margin:0 0 14px;padding-left:22px;">${rows}</ol>`;
}

/**
 * A screenshot from the reader's guide.
 *
 * Static JPEG copies under `/public/email/`, not the guide's WebP originals:
 * several mail clients still cannot draw WebP. Versioned names and an
 * `immutable` cache header, for the same Gmail-proxy reasons as the masthead.
 * The pictures show the practice library the guide was photographed in, never
 * a real reader.
 */
function screenshot(context: EmailContext, file: string, alt: string): string {
  const src = `${escapeHtml(context.appUrl)}/email/${file}`;
  return `<p style="margin:0 0 18px;"><img src="${src}" width="280" alt="${escapeHtml(alt)}" style="display:block;border:1px solid #E3D9C9;border-radius:12px;max-width:100%;height:auto;" /></p>`;
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:#1F6F5C;font-weight:700;">${escapeHtml(label)}</a>`;
}

/** One book in a loan email. `coverCid` is set only when the cover travels with the message. */
export interface EmailBook {
  title: string;
  copyCode: string;
  /** Already formatted in the library's timezone, e.g. "Friday 14 November 2026". */
  dueOn: string;
  coverCid: string | null;
}

/**
 * Books as a column of cards: cover on the left, words on the right. A table,
 * because that is the one layout every mail client draws the same way.
 */
function bookCards(books: EmailBook[]): string {
  const cards = books
    .map((book) => {
      const cover = book.coverCid
        ? `<img src="cid:${escapeHtml(book.coverCid)}" width="72" alt="Cover of ${escapeHtml(book.title)}" style="display:block;border:0;border-radius:6px;max-width:72px;height:auto;" />`
        : `<div style="width:72px;height:96px;border-radius:6px;background:#E8F1EE;"></div>`;
      return `<tr>
      <td width="84" valign="top" style="padding:12px 12px 12px 0;">${cover}</td>
      <td valign="top" style="padding:12px 0;">
        <p style="margin:0 0 4px;font-weight:700;font-size:16px;">${escapeHtml(book.title)}</p>
        <p style="margin:0 0 4px;font-size:13px;color:#5C4F42;">Book number ${escapeHtml(book.copyCode)}</p>
        <p style="margin:0;font-size:14px;">Please return by <strong>${escapeHtml(book.dueOn)}</strong></p>
      </td>
    </tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 18px;border-top:1px solid #E3D9C9;border-bottom:1px solid #E3D9C9;">${cards}</table>`;
}

function bookLines(books: EmailBook[]): string[] {
  return books.map((book) => `  • ${book.title} (${book.copyCode}) — please return by ${book.dueOn}`);
}

function contactLine(
  context: EmailContext,
  lead = "If anything is wrong, or you need the book for longer",
): string {
  return context.contactEmail
    ? `${lead}, just reply to this email or write to the librarian at ${context.contactEmail}.`
    : `${lead}, just reply to this email or have a word with the librarian.`;
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
  LOAN_ISSUED: "loan_issued",
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
 * The most important email in the system, and the family's welcome.
 *
 * If this does not arrive, a family cannot join — which is why delivery is
 * logged and a librarian can reissue the link from the desk. It is also the
 * one moment a parent is certainly reading, so it carries the whole "how this
 * library works" in short: the sign-in ID, the first sign-in, how to ask for a
 * book, how it comes back, and where everything else lives. The set-up button
 * stays first, because nothing else works until it is pressed.
 *
 * Numbers (loan period, book limit) and the room come from settings, never
 * from this file.
 */
export function activation(
  context: EmailContext,
  params: {
    guardianName: string;
    childName: string;
    memberCode: string;
    activationUrl: string;
    expiresInDays: number;
    borrowingPeriodDays: number;
    maxActiveLoans: number;
    venueName: string;
  },
): RenderedTemplate {
  const app = context.appUrl;
  const room = `the ${params.venueName}`;
  const bookWord = params.maxActiveLoans === 1 ? "book" : "books";
  const heading = `Welcome to ${context.libraryName}, ${params.childName}!`;

  const firstSignIn = [
    "Press the button below and choose a password, together with your child.",
    `Go to ${app}/login and choose “I am a reader”.`,
    `Type the library card number ${params.memberCode} and the password you chose.`,
    "That is it — you are on your own page, with My books and Find a book.",
  ];
  const borrowing = [
    `Find a book in the catalogue at ${app}/books and press “Ask the librarian for this book”.`,
    `Come to ${room} at a visiting time. The librarian hands the book over, and you get an email saying when it is due back.`,
    `A reader can have up to ${params.maxActiveLoans} ${bookWord} at a time, for ${params.borrowingPeriodDays} days.`,
  ];
  const returning = [
    "Need more time? On My books, press “Ask to Keep Longer”.",
    "Finished? Press “I want to return this book”, then bring the book back to the library room.",
    "We send a reminder a week before a book is due, and again the day before.",
  ];

  const body =
    paragraph(`Dear ${params.guardianName},`) +
    paragraph(
      `Good news — ${params.childName} is now a member of ${context.libraryName}. Here is everything you need to get started.`,
    ) +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px;background:#F3EBDD;border-radius:12px;"><tr><td style="padding:16px 18px;">
      <p style="margin:0 0 4px;font-size:13px;color:#5C4F42;">Sign-in ID (library card number)</p>
      <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:0.04em;font-family:Menlo,Consolas,monospace;">${escapeHtml(params.memberCode)}</p>
    </td></tr></table>` +
    button(params.activationUrl, "Set up the account") +
    paragraph(
      `This link works once and expires in ${params.expiresInDays} days. If it stops working, just ask the librarian for a fresh one.`,
    ) +
    subheading("Signing in for the first time") +
    steps(firstSignIn) +
    screenshot(context, "welcome-sign-in-v1.jpg", "The sign-in page, with “I am a reader” chosen and a card number typed in.") +
    paragraph(
      "Nobody at the library can see the password. If it is forgotten, press “Forgotten your password?” on the sign-in page and we will email you a link to choose a new one.",
    ) +
    subheading("Borrowing a book") +
    steps(borrowing) +
    screenshot(context, "welcome-ask-v1.jpg", "A book’s page with the “Ask the librarian for this book” button circled.") +
    subheading("Keeping it longer, and bringing it back") +
    steps(returning) +
    screenshot(context, "welcome-my-books-v1.jpg", "A borrowed book on the reader’s own shelf, with the date it is due back.") +
    screenshot(context, "welcome-return-v1.jpg", "The “I want to return this book” button.") +
    subheading("Useful links") +
    `<ul style="margin:0 0 14px;padding-left:22px;">
      <li style="margin:0 0 6px;">${link(`${app}/guide`, "How to use the library")} — every screen, step by step</li>
      <li style="margin:0 0 6px;">${link(`${app}/books`, "Find a book")} — search by title, author, shelf or age</li>
      <li style="margin:0 0 6px;">${link(`${app}/my-books`, "My books")} — what you have, and when it is due</li>
      <li style="margin:0 0 6px;">${link(`${app}/my-card`, "Library card")} — show it, or save a copy</li>
      <li style="margin:0 0 6px;">${link(`${app}/rules`, "Library rules")} and ${link(`${app}/faq`, "questions")}</li>
    </ul>` +
    paragraph(
      "There is more to discover once you are in: star ratings and reviews, the AI Librarian who answers questions about a book, “what to read next” suggestions, and Readers of the month.",
    ) +
    paragraph(
      context.contactEmail
        ? `Questions? Just reply to this email, or write to the librarian at ${context.contactEmail}.`
        : "Questions? Just reply to this email, or have a word with the librarian.",
    ) +
    paragraph("Happy reading!");

  const text = [
    `Dear ${params.guardianName},`,
    "",
    `${params.childName} is now a member of ${context.libraryName}.`,
    "",
    `Sign-in ID (library card number): ${params.memberCode}`,
    "",
    "Please help them choose a password for signing in:",
    params.activationUrl,
    `This link works once and expires in ${params.expiresInDays} days.`,
    "",
    "SIGNING IN FOR THE FIRST TIME",
    ...firstSignIn.map((line, index) => `  ${index + 1}. ${line}`),
    "",
    "BORROWING A BOOK",
    ...borrowing.map((line, index) => `  ${index + 1}. ${line}`),
    "",
    "KEEPING IT LONGER, AND BRINGING IT BACK",
    ...returning.map((line, index) => `  ${index + 1}. ${line}`),
    "",
    "USEFUL LINKS",
    `  How to use the library: ${app}/guide`,
    `  Find a book: ${app}/books`,
    `  My books: ${app}/my-books`,
    `  Library card: ${app}/my-card`,
    `  Rules: ${app}/rules`,
    "",
    "Nobody at the library can see the password. If it is forgotten, we send a new link rather than telling you the old one.",
    "",
    "Happy reading!",
  ].join("\n");

  return {
    subject: `Welcome to ${context.libraryName} — ${params.childName}'s account is ready`,
    html: layout(context, heading, body),
    text,
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
  const heading = "Setting a new password";
  const body =
    paragraph(
      `Someone asked to reset the sign-in details for ${params.childName}'s account at ${context.libraryName}.`,
    ) +
    button(params.resetUrl, "Choose a new password") +
    paragraph(
      `This link works once and expires in ${params.expiresInHours} hours.`,
    ) +
    paragraph(
      "If you did not ask for this, you can ignore this email — nothing has changed, and the old password still works.",
    );

  return {
    subject: `Setting a new password for ${params.childName}`,
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
  const heading = "The password was changed";
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
 * The librarian has just handed a book over.
 *
 * A thank-you, with the cover so the family can see which book came home, and
 * the date it is due back. It lists every book the child has out, not only the
 * new one, because "one or two books" is the normal visit and a second email
 * ten minutes later should not leave the first book's date in a different
 * message.
 */
export function loanIssued(
  context: EmailContext,
  params: {
    guardianName: string | null;
    childName: string;
    /** The book(s) just handed over. */
    issued: EmailBook[];
    /** Anything else the child already has at home. */
    alsoOut: EmailBook[];
  },
): RenderedTemplate {
  const many = params.issued.length > 1;
  const titles = params.issued.map((book) => book.title).join(" and ");
  const heading = `Thank you for borrowing ${many ? "these books" : "this book"}!`;
  const greeting = params.guardianName ? `Dear ${params.guardianName},` : "Hello,";
  const opening = `${params.childName} has just borrowed ${titles} from ${context.libraryName}. Thank you, and we hope ${many ? "they are" : "it is"} a wonderful read.`;

  const body =
    paragraph(greeting) +
    paragraph(opening) +
    bookCards(params.issued) +
    (params.alsoOut.length > 0
      ? paragraph(`Also at home with ${params.childName}:`) + bookCards(params.alsoOut)
      : "") +
    paragraph(
      "We will send a reminder a week before the return date, and again the day before. Need more time? Press “Ask to Keep Longer” on My books.",
    ) +
    `<p style="margin:0 0 14px;">See your books any time on ${link(`${context.appUrl}/my-books`, "My books")}.</p>` +
    paragraph(contactLine(context)) +
    `<p style="margin:18px 0 0;font-size:18px;font-weight:700;color:#1F6F5C;">Happy Reading!</p>`;

  return {
    subject: `Thank you for borrowing ${params.issued.length === 1 ? params.issued[0]!.title : `${params.issued.length} books`} — due back ${params.issued[0]!.dueOn}`,
    html: layout(context, heading, body),
    text: [
      greeting,
      "",
      opening,
      "",
      ...bookLines(params.issued),
      ...(params.alsoOut.length > 0
        ? ["", `Also at home with ${params.childName}:`, ...bookLines(params.alsoOut)]
        : []),
      "",
      "We will send a reminder a week before the return date, and again the day before.",
      `My books: ${context.appUrl}/my-books`,
      "",
      contactLine(context),
      "",
      "Happy Reading!",
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
 * read it. Every book on the same date for the same child travels in one
 * message, with its cover.
 *
 * What this message deliberately does NOT contain:
 *
 *   • any other child, any other family
 *   • a count of days late, or any number a family could feel scored by
 *   • a consequence — this library does not threaten one, and does not
 *     promise there is none either
 *   • a link that does anything. The book comes back to a room, not to a URL,
 *     and a reminder carrying a login link would be one more link for somebody
 *     to phish. My books is named, not linked with a token.
 */
export function loanReminder(
  context: EmailContext,
  params: {
    subject: string;
    /** The whole message, already worded by `reminderSentence`. */
    sentence: string;
    childName: string;
    books: EmailBook[];
    overdue: boolean;
    /** Optional, and only if the library published one. */
    openingNote?: string | null;
  },
): RenderedTemplate {
  const heading = params.overdue ? "A library book to come back" : "A library book due back soon";
  const closing = params.overdue
    ? `Please bring ${params.books.length > 1 ? "them" : "it"} to the library room on the next visiting day. ${contactLine(context, "If there is any problem with the book")}`
    : `Please bring ${params.books.length > 1 ? "them" : "it"} to the library room by then. Need more time? Press “Ask to Keep Longer” on My books.`;

  const body =
    paragraph(params.sentence) +
    bookCards(params.books) +
    paragraph(closing) +
    (params.overdue ? "" : paragraph(contactLine(context))) +
    (params.openingNote ? paragraph(params.openingNote) : "") +
    paragraph("Thank you, and happy reading!");

  return {
    subject: params.subject,
    html: layout(context, heading, body),
    text: [
      params.sentence,
      "",
      ...bookLines(params.books),
      "",
      closing,
      ...(params.overdue ? [] : ["", contactLine(context)]),
      ...(params.openingNote ? ["", params.openingNote] : []),
      "",
      "Thank you, and happy reading!",
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
