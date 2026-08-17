import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { MAIL_CAPTURE_DIR } from "@/server/lib/email/providers";
import { isProduction } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Captured mail (development)", robots: { index: false } };

/**
 * The development inbox.
 *
 * When EMAIL_PROVIDER=console, messages are written to `.mail/` instead of
 * being sent. This page reads them, so the activation flow can be walked
 * end to end without a single email reaching a real family.
 *
 * Returns 404 in production, unconditionally. Captured mail contains live
 * activation links; a page that lists them must not exist on the internet.
 */
export default async function DevMailPage() {
  if (isProduction) notFound();

  let files: string[] = [];
  try {
    files = (await readdir(MAIL_CAPTURE_DIR)).filter((name) => name.endsWith(".json"));
  } catch {
    files = [];
  }

  const messages = (
    await Promise.all(
      files.sort().reverse().slice(0, 40).map(async (name) => {
        try {
          const meta = JSON.parse(await readFile(join(MAIL_CAPTURE_DIR, name), "utf8")) as {
            id: string;
            capturedAt: string;
            to: string;
            subject: string;
            template: string;
            text: string;
          };
          return meta;
        } catch {
          return null;
        }
      }),
    )
  ).filter((message): message is NonNullable<typeof message> => message !== null);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8">
      <p className="inline-block rounded-full bg-warn-wash px-4 py-1.5 text-base font-bold text-warn">
        Development only
      </p>
      <h1 className="mt-3 text-4xl">Captured mail</h1>
      <p className="mt-3 text-lg text-ink-soft">
        Nothing here was actually sent. Links below are live — clicking one is exactly what a parent
        would do.
      </p>

      {messages.length === 0 ? (
        <div className="mt-10">
          <EmptyState illustration="📭" title="No mail captured yet">
            Approve a registration or ask for a password reset, and the message will appear here.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-10 flex flex-col gap-5">
          {messages.map((message) => {
            const links = [...message.text.matchAll(/https?:\/\/\S+/g)].map((match) => match[0]);

            return (
              <Card key={message.id} tone="shelf">
                <p className="text-base text-ink-soft">
                  {new Date(message.capturedAt).toLocaleString()} · {message.template}
                </p>
                <h2 className="mt-1 text-xl">{message.subject}</h2>
                <p className="mt-1 text-base text-ink-soft">To: {message.to}</p>

                {links.length > 0 ? (
                  <div className="mt-4 flex flex-col gap-2">
                    {links.map((link) => (
                      <a
                        key={link}
                        href={link}
                        className="break-all rounded-lg bg-primary-wash px-3 py-2 text-base font-bold text-primary-deep"
                      >
                        {link}
                      </a>
                    ))}
                  </div>
                ) : null}

                <details className="mt-4">
                  <summary className="cursor-pointer text-base font-bold text-ink-soft">
                    Full text
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface-sunk p-4 text-base">
                    {message.text}
                  </pre>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
