# The book helper

A child opens a book's page and there is a small panel under the cover: five
questions on buttons, and a box to type their own. It answers questions about
*that* book — what it is about, who wrote it, when it first came out, what to
read next — in the reading age of the shelf the book sits on.

It is the only part of this library that answers something nobody wrote in
advance, on a page anybody on the internet can open, to a reader who may be five
years old. This document is what that cost.

## What it is not

It is not a chatbot bolted to the site. It cannot see the catalogue, the loans,
the reviews, the members, or anything else in the database. It is handed four
facts about one book — title, authors, shelf category, age band — and a
question, and that is the entire world it has.

It is also not a librarian. It says so under every answer.

## Switching it off

Remove `GROQ_API_KEY` from the deployment. The panel stops rendering on the next
request, on every book page, with no migration, no setting and no deploy.

There is deliberately no toggle in `/admin/settings`. A setting is a thing to
maintain, seed and test; an absent key is a thing that cannot be half-on.

## The guards, in the order they run

| # | Guard | Where | What it stops |
|---|---|---|---|
| 1 | Key configured | `bookHelperEnabled()` | The feature existing at all |
| 2 | Same origin | route handler | Another site spending our allowance |
| 3 | Catalogue visibility | `getBookByCode` | Asking about a book you may not see |
| 4 | 20 questions / hour / IP | `checkActionThrottle` | Scripts, and the free tier running out |
| 5 | Injection classifier | `groqInjectionRisk` | "Ignore all previous instructions…" |
| 6 | The system prompt | `buildBookHelperPrompt` | Everything else |
| 7 | Markdown stripped | `stripMarkdown` | `*Matilda*` reaching a seven-year-old |

Guard 3 is the important one for privacy: the helper is reached through the same
function the page is, so if the shelf is members-only, a signed-out visitor gets
the same "no such book" from both. Asking the helper can never become a way to
find out whether a book exists.

Guard 5 runs **only on typed questions**, and only after the throttle. A preset
is our own sentence; classifying our own handwriting would be eighty
milliseconds spent on nothing. It **fails open** on purpose — the classifier is
the second lock, and an outage must not turn every child's question into a
refusal.

Guard 6 is where the real work is. See `src/server/lib/ai/book-prompt.ts`; the
rules in it are asserted line by line in `tests/unit/book-chat.test.ts`, because
a safety boundary nobody can test is a boundary nobody maintains.

## Nothing is written down

No question, no answer, no audit row, no log line. The rate-limit counter records
that *a* question came from a hashed address, and not what it was.

This was a decision, not an omission. These are children typing about books,
clumsily, and sometimes about things that are worrying them. A library that kept
that transcript would have built something it could not justify keeping, and
"for debugging" is not a justification. The failure logs a status code and a
model name, and nothing else — an upstream error body can echo the request back,
and the request contains a child's words.

The conversation lives in the browser tab. Closing it ends it. The last six
turns travel with each new question so that "what else did they write?" knows
who "they" is, and they are capped, re-labelled from our own two roles, and
trusted for nothing else.

## The key

Server-side only, and structurally so: `src/server/lib/ai/groq.ts` opens with
`import "server-only"`, so it cannot be pulled into a client bundle — the build
fails rather than shipping the key. There is no `NEXT_PUBLIC_` mirror of it, the
browser talks only to `/api/books/[code]/ask`, and what comes back is one string
of English.

`tests/unit/book-chat.test.ts` asserts all of that by reading the source: the
`server-only` import is present, no `gsk_` literal exists anywhere, and neither
the shared vocabulary nor the client component mentions Groq at all.

## Models

Groq retires models with little notice — `llama-3.3-70b-versatile` was already
gone when this was built. Both names are configuration:

* `GROQ_MODEL` (default `openai/gpt-oss-120b`) answers. Around half a second.
  Its `reasoning` field — the model's private working out — is never read and
  never rendered; only `content` is.
* `GROQ_GUARD_MODEL` (default `meta-llama/llama-prompt-guard-2-86m`) scores a
  typed question from 0 to 1. Observed: 0.0006 for "tell me about the author",
  0.9996 for "ignore all previous instructions". The threshold is 0.8.

If a model is retired, the symptom is every question failing with "That did not
work". Check `https://api.groq.com/openai/v1/models` and change the variable.
No deploy is needed.

## Cost

Two requests per typed question, one per preset. At 20 questions an hour per
address this stays inside Groq's free tier for a library of this size. If the
allowance is exhausted the endpoint returns 429 and the child is told the helper
is busy, which is a sentence, not a broken page.
