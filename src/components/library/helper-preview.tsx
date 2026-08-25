import { Icon } from "@/components/ui/icon";

/**
 * What the book helper looks like, shown to somebody who has not opened a book
 * page yet.
 *
 * Every word below is **an example and is labelled as one.** It would have been
 * easy to wire this to the live helper and let the front page answer real
 * questions, and it was the wrong trade: it spends the shared free allowance on
 * people who are browsing rather than reading, and the panel is two clicks away
 * on any book. A drawing of the thing, honestly captioned, is enough.
 *
 * The exchange is chosen to make the useful point rather than the impressive
 * one. "When was it first published" is a question a parent understands the
 * value of instantly, and the answer shows the helper doing the thing that
 * actually matters here: saying plainly what it is unsure of.
 */
export function HelperPreview() {
  return (
    <figure className="rounded-[var(--radius-card)] bg-sky-wash p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary-deep shadow-lift"
        >
          <Icon name="sparkle" />
        </span>
        <p className="text-base font-bold text-ink">Ask about this book</p>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <p className="self-end max-w-[85%] rounded-[var(--radius-card)] bg-primary px-4 py-2.5 text-base text-white">
          Who wrote it?
        </p>

        <div className="max-w-[92%] rounded-[var(--radius-card)] bg-surface px-4 py-3 shadow-lift">
          <p className="text-base leading-relaxed text-ink">
            Roald Dahl was a British writer who loved telling funny, surprising stories for
            children. He also wrote Charlie and the Chocolate Factory and The BFG.
          </p>
          <p className="mt-2.5 flex items-start gap-1.5 text-sm text-ink-soft">
            <Icon name="info" className="mt-0.5 shrink-0" />
            A computer wrote this answer, so it can get things wrong. Ask a librarian if it
            matters.
          </p>
        </div>
      </div>

      <figcaption className="mt-4 text-sm text-ink-soft">
        An example. The helper sits on every book&rsquo;s page and answers questions about that
        book, in words that suit the age the book is shelved for.
      </figcaption>
    </figure>
  );
}
