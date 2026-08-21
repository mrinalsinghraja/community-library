import { Card } from "@/components/ui/card";
import { JOIN_HELP_MESSAGE, whatsAppLink } from "@/lib/whatsapp";

/**
 * "I am stuck, please help me."
 *
 * The one thing a parent needs when a form defeats them, and the thing this
 * library had no answer for: the only route to a human was an email address
 * answered whenever somebody next opened that inbox.
 *
 * Three decisions worth keeping.
 *
 * **The message is already written.** A parent who is embarrassed to be stuck,
 * or not confident writing in English, has nothing to compose — they press the
 * button and press send. It also means the person answering knows what the
 * message is about before they open it.
 *
 * **It says a person will answer, and may not answer at once.** A chat window
 * sets an expectation of an instant reply, and this is a neighbour who also has
 * a job. Saying so in advance is the difference between a wait and a let-down,
 * and it is the honest thing to put next to a volunteer's phone number.
 *
 * **No number, no block.** When the library has not set a contact phone this
 * renders nothing. An affordance that opens WhatsApp addressed to nobody is
 * worse than no affordance.
 *
 * The mark is WhatsApp's own, because that shape is the whole point of the
 * button. The colour underneath is this library's green rather than WhatsApp's:
 * white on WhatsApp green measures under 2:1, and nothing here is allowed to
 * fail a contrast check for the sake of matching somebody else's palette.
 */

/** WhatsApp's glyph. Filled, unlike the stroke icons in `Icon`, so it is its own file. */
function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.2 8.2 0 0 1 5.83 2.42 8.2 8.2 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.09-.16.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03 0 1.2.87 2.35.99 2.52.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

export function WhatsAppHelp({
  phone,
  heading = "Stuck? Ask a person",
  lead,
  className,
}: {
  /** The library's `contactPhone` setting. Nothing renders when it is unset. */
  phone: string | null;
  heading?: string;
  lead?: string;
  className?: string;
}) {
  const link = whatsAppLink(phone, JOIN_HELP_MESSAGE);
  if (!link) return null;

  return (
    <Card tone="primary" className={className}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white"
        >
          <WhatsAppMark className="h-7 w-7" />
        </span>

        <div className="flex flex-col gap-3">
          <h2 className="text-2xl">{heading}</h2>

          <p className="text-lg text-ink-soft">
            {lead ??
              "Having trouble creating an account for your child, or getting a book issued? Send us a message and we will walk you through it."}
          </p>

          <p className="text-base text-ink-soft">
            A neighbour answers these, not a robot — so please give us a little time to write back.
          </p>

          <p>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-[var(--radius-button)] bg-primary px-5 py-3 text-base font-semibold text-white no-underline transition-colors hover:bg-primary-deep"
            >
              <WhatsAppMark className="h-5 w-5" />
              Message us on WhatsApp
            </a>
          </p>
        </div>
      </div>
    </Card>
  );
}
