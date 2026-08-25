import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CardDownloads } from "@/app/my-card/card-downloads";
import { LibraryCard } from "@/components/library/library-card";
import { PublicShell } from "@/components/layout/site-shell";
import { StaffShell } from "@/components/layout/staff-shell";
import { ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/states";
import { Icon } from "@/components/ui/icon";
import { formatInTimezone } from "@/lib/dates";
import { CARD_MESSAGES } from "@/lib/library-card";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getOwnLibraryCard } from "@/server/services/card-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My library card" };

/**
 * A reader's own card, big enough to look at and small enough to keep.
 *
 * There is no id in this route. The card is whoever is signed in, which is what
 * makes "can I see another child's card?" a question with no mechanism behind
 * it rather than a check somebody has to remember to write.
 *
 * Staff reach this page from the same menu and are told plainly that they do
 * not have one. That is a sentence, not a 403: a librarian following a link is
 * not doing anything wrong.
 */
export default async function MyCardPage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();

  if (!actor) redirect("/login?next=/my-card");

  const facts = await getOwnLibraryCard();
  const { settings } = await getCurrentLibrary();
  const Shell = actor.kind === "STAFF" ? StaffShell : PublicShell;

  if (!facts) {
    return (
      <Shell branding={branding} actor={actor} title={CARD_MESSAGES.title}>
        <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
          <h1 className="garden-rule inline-block text-4xl">{CARD_MESSAGES.title}</h1>
          <div className="mt-14">
            <Callout tone="info" title="No card on this account">
              {CARD_MESSAGES.notAMember}
            </Callout>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell branding={branding} actor={actor} title={CARD_MESSAGES.title}>
      <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
        <h1 className="garden-rule inline-block text-4xl">{CARD_MESSAGES.title}</h1>

        <p className="mt-14 max-w-xl text-lg text-ink-soft">{CARD_MESSAGES.intro}</p>

        <div className="mt-8 max-w-xl">
          <LibraryCard facts={facts} timezone={settings.timezone} />
        </div>

        <div className="max-w-xl">
          <CardDownloads
            facts={{
              readerName: facts.readerName ?? "",
              memberCode: facts.memberCode ?? "",
              apartment: facts.apartment,
              joinedLabel: facts.joinedAt
                ? formatInTimezone(facts.joinedAt, settings.timezone, "MMM yyyy")
                : null,
              avatarKey: facts.avatarKey,
              libraryName: facts.libraryName,
              communityName: facts.communityName,
              rules: facts.rules,
            }}
          />

          {/*
            Said once, here, where somebody is deciding whether to send the file
            to a family group. The card on screen has their child's face on it
            and the downloads do not, and a parent who notices deserves to know
            it was a decision rather than a bug.
          */}
          <p className="mt-4 flex items-start gap-2 text-base text-ink-soft">
            <Icon name="hide" className="mt-1 shrink-0" />
            The saved copies show the reader&rsquo;s chosen picture-mark rather than their
            photograph, so a card that gets forwarded carries less about your child than the one on
            this screen.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/rules" variant="quiet" size="sm" icon={<Icon name="audit" />}>
              Read all the rules
            </ButtonLink>
            <ButtonLink href="/account" variant="quiet" size="sm" icon={<Icon name="reader" />}>
              Back to my account
            </ButtonLink>
          </div>
        </div>
      </div>
    </Shell>
  );
}
