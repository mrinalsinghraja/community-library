/**
 * The reader's guide: how to use the library website, step by step, with a
 * picture of each screen (ADR-075).
 *
 * Written for two people at once. A parent reads it before joining and while
 * helping a child sign in for the first time; a child reads it to find out what
 * the buttons do. So every step says what to press, what happens next, and
 * nothing a seven-year-old would have to ask about.
 *
 * Content is data rather than JSX so that `tests/unit/reader-guide.test.ts` can
 * check it: every picture exists, every id is unique, and no step drifts into
 * a promise the software does not keep.
 *
 * Rules for anything added here:
 *
 *   1. **No typed numbers or names.** The loan period, the borrowing limit, the
 *      card-number format and the room come from settings via `GuideFacts`,
 *      exactly like the rules and questions pages.
 *   2. **The pictures show a practice library**, with made-up books and a
 *      made-up reader, taken from a local copy of this software. Never a
 *      screenshot of the live site signed in: that would put a real child on a
 *      public page.
 *   3. **Button names are quoted exactly as the screen prints them**, so a
 *      child can match the words.
 */

export interface GuideFacts {
  /** "the Yoga Room" style: the room's short name. */
  venueName: string;
  /** How long a book may stay at home. */
  borrowingPeriodDays: number;
  /** How many books a reader may have at once, asks included. */
  maxActiveLoans: number;
  /** A worked example of this library's card number. */
  cardExample: string;
}

export interface GuideImage {
  /** File under /public/guide, without extension. */
  file: string;
  /** Pixel size of the stored file; the page draws it at half, like a phone. */
  width: number;
  height: number;
  alt: string;
}

export interface GuideStep {
  title: string;
  /** Short paragraphs. May be empty when the step is all "do this". */
  body?: string[];
  /** Optional list of "press this, then this". */
  doThis?: string[];
  /** A word to the parent, set apart. */
  parentNote?: string;
  image?: GuideImage;
}

export interface GuideSection {
  id: string;
  title: string;
  /** One line under the heading: who this part is for, or when you need it. */
  lead: string;
  icon: "reader" | "key" | "search" | "book" | "myBooks" | "calendar" | "sparkle" | "star" | "card" | "settings" | "gift";
  steps: GuideStep[];
}

const shot = (file: string, width: number, height: number, alt: string): GuideImage => ({
  file,
  width,
  height,
  alt,
});

const books = (n: number) => (n === 1 ? "one book" : `${n} books`);

export function readerGuide(facts: GuideFacts): GuideSection[] {
  const days = `${facts.borrowingPeriodDays} days`;

  return [
    {
      id: "joining",
      title: "Joining the library",
      lead: "For parents and guardians. It takes a few minutes, and it is free.",
      icon: "reader",
      steps: [
        {
          title: "Fill in the joining form",
          body: [
            "Press “Ask for a library card” on the front page, or “How to join” in the menu. A parent or guardian fills the form in, not the child.",
            "It asks for your child’s name and the year they were born, your flat, and your own name, email and phone. Nothing on it is shown to another family.",
          ],
          parentNote:
            "Use an email address you check. The link to set your child’s password, and any password reset later, goes there.",
          image: shot("03-join", 780, 1600, "The joining form, headed “Every child in the building can have a card”, starting with a section called “About your child”."),
        },
        {
          title: "A librarian checks it, then you choose a password",
          body: [
            "A librarian — a neighbour who volunteers — reads the form and approves it, usually the same day.",
            "You then get an email with a link. Open it, choose a password for your child, and the card is ready. The link works once, so use it when you have a minute.",
          ],
          image: shot("02-how-to-join", 780, 3036, "The four joining steps: fill in the joining form, a librarian reads it, choose a password, come and borrow a book."),
        },
      ],
    },
    {
      id: "signing-in",
      title: "Signing in",
      lead: "Readers sign in with the number on their library card.",
      icon: "key",
      steps: [
        {
          title: "Press “Sign in”",
          body: ["It is at the top of every page, on the right."],
          image: shot("01-home", 780, 1440, "The library’s front page on a phone, with the “Sign in” button at the top circled."),
        },
        {
          title: "Type your card number and password",
          doThis: [
            "Choose “I am a reader”.",
            `Type your library card number, for example ${facts.cardExample}.`,
            "Type your password. “Show” lets you check what you typed.",
            "Press “Sign in”.",
          ],
          parentNote:
            "If a wrong password is typed several times in a row, the card is paused for a short while to keep it safe. Wait fifteen minutes, or use “Forgotten your password?” below.",
          image: shot("04-login", 780, 1040, "The sign-in form with “I am a reader” chosen, a card number and a hidden password typed in, and the “Sign in” button circled."),
        },
        {
          title: "Forgotten your password?",
          body: [
            "Press “Forgotten your password?” on the sign-in page and type your card number. A link to choose a new password goes to the parent or guardian’s email — never to anyone else.",
            "Nobody at the library can see your password, so nobody can tell it to you. The link is the way back in.",
          ],
          image: shot("05-forgot", 780, 1440, "The “Forgotten your password?” page with a box for the library card number and a “Send the link” button."),
        },
        {
          title: "Your own page",
          body: [
            "After signing in you land on your own page. It has four doors: My books, Find a book, My library card, and Account details.",
          ],
          image: shot("06-account", 780, 1780, "A reader’s own page saying “Hello, Demo Reader!” with doors for My books and Find a book."),
        },
      ],
    },
    {
      id: "finding",
      title: "Finding a book",
      lead: "Anyone can look through the catalogue, even without signing in.",
      icon: "search",
      steps: [
        {
          title: "Search the catalogue",
          body: [
            "Open “Catalogue” in the menu. Type part of a title or the name of the person who wrote it, then press “Show me”.",
            "You can also pick a shelf, the ages a book was written for, and whether to see the newest, best loved or most borrowed first. The ages are a suggestion — anyone may borrow any book.",
          ],
          doThis: [
            "Tick “Only books on the shelf right now” to see just the books you could take home this week.",
          ],
          image: shot("07-catalogue-search", 780, 1310, "The catalogue search box with “Dahl” typed in, and the shelf, age and order choices below it."),
        },
        {
          title: "Pick a book",
          body: [
            "Each card shows the cover, who wrote it, and a green “On the shelf” when it is in the library room. At the bottom is the book’s number and which row it sits on. Press a card to open the book.",
          ],
          image: shot("08-catalogue-results", 780, 2258, "Three book cards found by the search, each marked “On the shelf”, with the book number and row at the bottom."),
        },
        {
          title: "The book’s own page",
          body: [
            "This page tells you whether the book is on the shelf, what age it is written for, and what other readers thought of it.",
            "The box “Finding it on the shelf” gives the number printed on the book’s spine and the row it is on. Our books sit in number order, so you can walk straight to it in the library room.",
            "Further down you will find other books by the same author, and more books from the same shelf.",
          ],
          image: shot("09-book-page", 780, 2382, "The page for The BFG, showing the cover, “On the shelf”, and the box “Finding it on the shelf” with the book number and Row 1."),
        },
      ],
    },
    {
      id: "borrowing",
      title: "Borrowing a book",
      lead: `You can have ${books(facts.maxActiveLoans)} at a time, for ${days} each.`,
      icon: "book",
      steps: [
        {
          title: "Ask the librarian for it",
          body: [
            "On the book’s page, press “Ask the librarian for this book”. You need to be signed in, and the book needs to be on the shelf.",
          ],
          image: shot("10-ask-button", 780, 868, "The “Ask the librarian for this book” button circled, under the book’s shelf number."),
        },
        {
          title: "Wait for the librarian",
          body: [
            "The page now says you have asked for it. The book stays in the library room until the librarian hands it to you — asking on the website keeps it for you, it does not send it anywhere.",
            "Changed your mind? Press “Actually, never mind” and the book is free for someone else.",
          ],
          image: shot("11-asked", 780, 1020, "A pink box saying “You’ve asked for this one. The librarian will bring it to you.” with an “Actually, never mind” button."),
        },
        {
          title: "See it on My books",
          body: [
            "Everything you have asked for is listed on “My books”, under “Books you have asked for”.",
          ],
          image: shot("12-my-books-asked", 780, 710, "The “Books you have asked for” list on My books, showing The BFG waiting for the librarian."),
        },
        {
          title: `Collect it from ${facts.venueName}`,
          body: [
            `Come to ${facts.venueName} at one of the visiting times on your “My books” page. A librarian will be there to hand the book over, and to take back any you are returning.`,
          ],
          image: shot("17-visits", 780, 936, "“When to come to the library room”, listing this week’s visiting times, 10:00 to 10:30 am and 7:00 to 7:30 pm."),
        },
        {
          title: "Your book at home",
          body: [
            "Once the librarian hands the book over, it appears under “Your reading shelf” on My books, with a big number showing how many days are left and the date it is due back.",
          ],
          image: shot("13-loan", 780, 1880, "The BFG on “Your reading shelf” with “14 days left”, and buttons “Ask to Keep Longer” and “I want to return this book”."),
        },
      ],
    },
    {
      id: "keeping-and-returning",
      title: "Keeping it longer, and bringing it back",
      lead: "Both happen from your “My books” page.",
      icon: "calendar",
      steps: [
        {
          title: "Need more time? Ask to keep it longer",
          body: [
            `Under the book, press “Ask to Keep Longer”. The librarian will look at it and, if they say yes, you get another ${days}.`,
          ],
          image: shot("14a-keep-button", 780, 302, "The “Ask to Keep Longer” button circled."),
        },
        {
          title: "The librarian will let you know",
          body: [
            "The book now says you have asked. If you finish it sooner after all, press “Actually, never mind”.",
          ],
          image: shot("14b-keep-asked", 780, 404, "A message saying “You’ve asked the librarian. They will let you know.”"),
        },
        {
          title: "Finished it? Tell the library",
          body: [
            "Press “I want to return this book”. This tells the librarian it is coming back, so they can look out for it.",
          ],
          image: shot("15a-return-button", 780, 248, "The “I want to return this book” button circled, under “Finished this book?”."),
        },
        {
          title: "Then bring the book to the library room",
          body: [
            `Bring it to ${facts.venueName} at a visiting time and hand it to the librarian. The book leaves your shelf when the librarian takes it back — pressing the button alone does not return it.`,
            "Still reading after all? Press “I want to keep reading”.",
          ],
          parentNote: "If a book gets lost or damaged, just tell the librarian.",
          image: shot("15b-return-told", 780, 340, "A message saying “You told the library. Bring the book to the library room and a librarian will take it back.”"),
        },
      ],
    },
    {
      id: "my-books",
      title: "More on your My books page",
      lead: "Your page is where the library talks to you.",
      icon: "myBooks",
      steps: [
        {
          title: "The notice board",
          body: [
            "At the top of My books. Anything the library wants every reader to know — new books, a change of time — is posted here.",
          ],
          image: shot("16-notice", 780, 308, "A notice saying “New books on the shelf — Eight new books arrived this week.”"),
        },
        {
          title: "Readers of the month",
          body: [
            "The readers who have taken the most books home this month, shown by first name and picture. It is a celebration, not a race — every book you finish counts.",
          ],
          image: shot("18-readers-board", 780, 876, "“Readers of the month” with one reader and five empty places saying “It could be you”."),
        },
        {
          title: "What to read next",
          body: [
            "After you have borrowed a couple of books, the AI Librarian suggests three more from our own shelves that you might like. Press “Suggest something new” for a fresh set.",
            "A suggestion is not a booking — you still ask for the book in the usual way.",
          ],
          image: shot("19-ai-suggests", 780, 1812, "“The AI Librarian suggests”, recommending Charlotte’s Web with a one-line reason, and a “Suggest something new” button."),
        },
      ],
    },
    {
      id: "ai-librarian",
      title: "Asking the AI Librarian about a book",
      lead: "On every book’s page, below the book’s details.",
      icon: "sparkle",
      steps: [
        {
          title: "Press a question, or type your own",
          body: [
            "Press “What is this book about?”, “Who wrote it?”, “Is it funny or a bit scary?” and more — or type your own question about the book and press “Ask”.",
            "Answers are written for the age the book is meant for.",
          ],
          parentNote:
            "The AI Librarian answers questions about the book. Nothing a child types is kept, and no name or card number is sent with it. Answers come from AI, which can make mistakes, so check anything important with a librarian.",
          image: shot("20-ai-librarian", 780, 2242, "The AI Librarian on The Jungle Book’s page, answering “What is this book about?”, with more question buttons below."),
        },
      ],
    },
    {
      id: "stars",
      title: "Giving a book stars",
      lead: "Once you have borrowed and brought back a book, you can say what you thought.",
      icon: "star",
      steps: [
        {
          title: "Pick your stars and say why",
          doThis: [
            "Open the book’s page. Under “What did you think?”, press one to five stars.",
            "If you like, write a few lines about the book — up to a hundred words. Write about the book, not about people.",
            "Choose “Show my first name” or “Don’t show my name”.",
            "Press “Share what I thought”.",
          ],
          parentNote:
            "A librarian reads every review before anyone else can see it. Other readers only ever see a first name — never a full name or flat.",
          image: shot("21-review-form", 780, 1584, "Five stars chosen for Matilda with a short review typed in, “Show my first name” selected, and “Share what I thought” circled."),
        },
        {
          title: "Everything you have said",
          body: [
            "“What I thought” in the menu keeps every review you have written.",
          ],
          image: shot("22-my-reviews", 780, 1216, "“What I thought” showing a five-star review of Matilda."),
        },
      ],
    },
    {
      id: "card",
      title: "Your library card",
      lead: "Open “My card” in the menu.",
      icon: "card",
      steps: [
        {
          title: "Show it, or keep a copy",
          body: [
            "Your card shows your name and card number. Show it in the library room, or save a copy with “Download as a picture” or “Download as a PDF”.",
          ],
          parentNote:
            "The saved copies show a coloured initial instead of your child’s photograph, so a forwarded card says less about them.",
          image: shot("23-my-card", 780, 1984, "The reader card for Demo Reader, with the library’s rules for looking after a book and the two download buttons."),
        },
      ],
    },
    {
      id: "account",
      title: "Your details and password",
      lead: "Open “My library”, then “Account details”.",
      icon: "settings",
      steps: [
        {
          title: "Something wrong in your details?",
          body: [
            "Your name, flat and your guardian’s details are listed here. Press “Something here is wrong” to send a correction — a librarian checks it before anything changes.",
          ],
          image: shot("24-details", 780, 912, "“Your details” with a name, flat and guardian’s details, and a “Something here is wrong” button."),
        },
        {
          title: "Change your password",
          body: [
            "Under “Your password”, press “Change my password”. If you have forgotten it, “Email me a reset link” sends a link to your guardian instead.",
          ],
          image: shot("25-password", 780, 768, "“Your password” with the “Change my password” button circled and “Email me a reset link” below."),
        },
        {
          title: "Type the old password, then the new one",
          body: [
            "A good password is two or three words joined together, like “bluecatjumps” — easy to remember, hard to guess.",
            "Changing it signs you out everywhere, including here, so sign in again with the new one.",
          ],
          image: shot("26-change-password", 780, 1800, "The “Change your password” page, with boxes for the current password and the new one."),
        },
        {
          title: "Sign out on a shared phone or computer",
          body: [
            "At the bottom of Account details, press “Sign out”. Always do this on a device other people use.",
          ],
          image: shot("27-sign-out", 780, 434, "The “Sign out” button circled."),
        },
      ],
    },
    {
      id: "giving",
      title: "Giving books to the library",
      lead: "Every book on our shelves came from a neighbour.",
      icon: "gift",
      steps: [
        {
          title: "Bring them to the librarian",
          body: [
            `Bring books you would like to give to ${facts.venueName} at a visiting time, and hand them to the librarian. Tell them how you would like to be thanked — by name, or not at all.`,
            "Everyone who gives is thanked on the “Book friends” page. Giving a book is never a condition of joining.",
          ],
          image: shot("28-donors", 780, 1800, "The “Thank you, book friends” page."),
        },
      ],
    },
  ];
}

/** Every step, numbered through the whole guide, for "step 12" in conversation. */
export function numberSteps(sections: GuideSection[]): Map<GuideStep, number> {
  const numbers = new Map<GuideStep, number>();
  let n = 0;
  for (const section of sections) for (const step of section.steps) numbers.set(step, ++n);
  return numbers;
}
