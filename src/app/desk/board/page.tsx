import type { Metadata } from "next";

import { NoticeForm, WithdrawNotice } from "@/app/desk/board/notice-form";
import { StaffShell } from "@/components/layout/staff-shell";
import { MessageBoard } from "@/components/library/message-board";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Callout } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { BOARD_MESSAGES } from "@/lib/message-board";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { currentNotice, listNotices } from "@/server/services/announcement-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notice board" };

/**
 * What the library says to everybody at once.
 *
 * Guarded by `announcement.manage`, which the Super Admin holds alone. This is
 * the one surface in the application that speaks to every family and is not
 * about a book — the same property that makes it useful makes it the wrong
 * thing to hand out widely. A librarian who needs something said asks for it to
 * be posted, which is a conversation and takes a minute.
 *
 * The preview at the top is the real card, rendered from the real service.
 * Somebody about to write to every family in the building should see what they
 * are about to write, not an approximation of it.
 */
export default async function DeskBoardPage() {
  const actor = await requirePermissionForPage("announcement.manage", {
    signedOutTo: "/login?next=/desk/board",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  const [live, history] = await Promise.all([currentNotice(), listNotices()]);
  const posted = history.filter((notice) => notice.live);

  return (
    <StaffShell branding={branding} actor={actor} title="Notice board">
      <p className="text-base text-ink-soft">
        {live.special
          ? "A notice is up. Every reader sees it on their own page."
          : BOARD_MESSAGES.deskEmpty}
      </p>

      <h2 className="mt-8 text-2xl">What readers see right now</h2>
      <MessageBoard notice={live} className="mt-4 max-w-2xl" />

      {posted.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatusBadge tone="soon">
            <Icon name="info" /> Live
          </StatusBadge>
          {posted.map((notice) => (
            <WithdrawNotice key={notice.id} noticeId={notice.id} />
          ))}
        </div>
      ) : null}

      <Card className="mt-10 max-w-2xl">
        <CardTitle icon={<Icon name="mail" />}>Post something</CardTitle>
        <CardBody>
          <Callout tone="info" title="One notice at a time" className="mb-5">
            Posting replaces whatever is up now. It reaches every reader the next time their page
            loads — there is nothing to schedule and nothing to send.
          </Callout>
          <NoticeForm />
        </CardBody>
      </Card>

      {history.length > 0 ? (
        <>
          <h2 className="mt-10 text-2xl">What has been posted</h2>
          <ul className="mt-4 flex max-w-2xl list-none flex-col gap-3 p-0">
            {history.map((notice) => (
              <li
                key={notice.id}
                className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-bold text-ink">{notice.title}</p>
                  <p className="text-sm text-ink-soft">
                    {formatInTimezone(notice.postedAt, settings.timezone, "d MMM yyyy")}
                    {notice.live ? " · up now" : ""}
                  </p>
                </div>
                <p className="mt-1 whitespace-pre-line text-base text-ink-soft">{notice.body}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </StaffShell>
  );
}
