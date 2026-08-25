/**
 * The words the book helper uses, and the limits it works inside.
 *
 * Isomorphic on purpose: the composer in the browser and the route handler on
 * the server must agree about how long a question may be and what the preset
 * questions are, and the only way to guarantee that is for both to read the
 * same file. Nothing here is a secret and nothing here talks to Groq — the key,
 * the model and the prompt live in `server-only` code.
 *
 * The register throughout is a librarian kneeling down to a child's height:
 * short words, no jargon, never "AI", never "assistant". A nine-year-old asking
 * about Matilda does not need to be told about language models. They do need to
 * be told, plainly and every single time, that the answers come from a computer
 * and a computer can be wrong — which is what `disclaimer` is for, and why it
 * sits under every answer rather than once at the top of the page.
 */

/** Longest question we will send. Two lines of typing, not an essay. */
export const QUESTION_MAX_CHARS = 200;

/**
 * How many earlier turns travel with a follow-up.
 *
 * Six is three exchanges — enough that "and what else did they write?" knows
 * what "they" means, short enough that a long session cannot grow into a
 * transcript worth harvesting. Nothing is stored: this history lives in the
 * browser tab and dies with it.
 */
export const HISTORY_MAX_MESSAGES = 6;

/** Questions per hour from one place. Generous for a child, useless for a script. */
export const QUESTIONS_PER_HOUR = 20;

export type BookChatRole = "reader" | "helper";

export interface BookChatTurn {
  role: BookChatRole;
  text: string;
}

/**
 * The buttons a child presses instead of typing.
 *
 * Every one is a whole question in a child's own voice, not a topic label — a
 * button that says "Author" makes the child do the work of imagining what it
 * will ask. These are also the safe path: a preset carries an id rather than
 * text, the server holds the wording, and nothing a browser sends can change
 * what gets asked.
 */
export interface PresetQuestion {
  id: string;
  /** What the button says. */
  label: string;
  /** What the server actually asks on the child's behalf. */
  question: string;
}

export const PRESET_QUESTIONS: readonly PresetQuestion[] = [
  {
    id: "about",
    label: "What is this book about?",
    question: "What is this book about? Tell me enough to know if I would like it.",
  },
  {
    id: "author",
    label: "Who wrote it?",
    question:
      "Tell me about the person who wrote this book, and what else they have written for children.",
  },
  {
    id: "published",
    label: "When was it first published?",
    question:
      "When was this book first published, and where? Say if you are not sure of the year.",
  },
  {
    id: "feel",
    label: "Is it funny or a bit scary?",
    question:
      "What does this book feel like to read — funny, sad, exciting, a little scary? Is it easy or hard to read?",
  },
  {
    id: "next",
    label: "What should I read next?",
    question:
      "If I like this book, what other books might I enjoy? Say why I might like each one.",
  },
] as const;

export function presetById(id: string): PresetQuestion | null {
  return PRESET_QUESTIONS.find((preset) => preset.id === id) ?? null;
}

/** Trims and collapses a typed question. Returns null when nothing is left. */
export function normaliseQuestion(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, QUESTION_MAX_CHARS);
}

export const BOOK_CHAT_MESSAGES = {
  heading: "Ask about this book",
  intro: "Press a question, or type your own.",
  placeholder: "Type your question about this book…",
  send: "Ask",
  sending: "Thinking…",
  clear: "Start again",
  /**
   * Under every answer, every time. Said in the second person and without the
   * word "AI", because the point is not to name the technology — it is to make
   * sure a child knows to check with a person.
   */
  disclaimer: "A computer wrote this answer, so it can get things wrong. Ask a librarian if it matters.",
  emptyQuestion: "Type a question first.",
  tooLong: `Please keep it under ${QUESTION_MAX_CHARS} letters.`,
  /**
   * One message for every refusal the guard makes, on purpose. Telling somebody
   * *which* rule they tripped is telling them what to try next, and a child who
   * asked something ordinary is better served by "ask about the book" than by
   * an explanation of prompt injection.
   */
  offTopic: "I can only talk about books here. Try asking me something about this one!",
  /**
   * *This reader* has asked a lot in one hour. Personal, clears on its own, and
   * says so.
   */
  busy: "That is a lot of questions! Have a read, and ask me again in a little while.",
  /**
   * The library's whole daily allowance is gone — nothing to do with this
   * child, and it does not come back until tomorrow.
   *
   * The metaphor is the owner's and it is a good one: fuel is a thing a child
   * already understands running out and refilling, it carries no blame, and it
   * makes the honest point that somebody is paying for this. The second
   * sentence matters most — the library is not broken, only the helper is
   * asleep, and the books are still there.
   */
  outOfFuel:
    "Our helper has used up all its thinking fuel for today. It fills up again tomorrow — the books are still right here in the meantime!",
  failed: "That did not work. Please try again in a moment.",
  /** Shown when the helper is switched off entirely (no key configured). */
  unavailable: "The book helper is having a rest just now.",
} as const;

/**
 * Takes the formatting marks out of an answer.
 *
 * The system prompt asks for plain sentences and the model mostly complies —
 * and then writes `*Matilda*` anyway, which renders on the page as an asterisk,
 * the word, and another asterisk. A child reads that as a typing mistake.
 *
 * So the instruction is kept (it shapes the whole answer, not only the marks)
 * and this runs afterwards regardless. An instruction the model may ignore is
 * not a guarantee; a regular expression is.
 *
 * Deliberately narrow: emphasis, code ticks, headings and list bullets. It does
 * not touch punctuation, quotation marks or anything inside a word, because a
 * book called *A***** is not a problem this library has.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*•]\s+/gm, "")
    .trim();
}
