# Design system — "Story Garden"

The visual language of a community children's library. One brief runs through
every decision here: it has to work for a six-year-old still decoding words and
for a fourteen-year-old who would be embarrassed by anything babyish.

Source of truth is `src/app/globals.css`. This document explains the choices;
the CSS enforces them.

---

## 1. Where the colour comes from

The library's mark is three brush-drawn butterflies over a leaf-green rule. Both
colours were **sampled out of the artwork**, not chosen to sit near it:

| | hex | where |
|---|---|---|
| berry | `#A82878` | the butterflies |
| leaf | `#78B030` | the rule under the wordmark |

Because the interface and the mark are literally the same colours, the logo
never looks pasted onto a page that was designed without it.

### The measurement that shaped everything

The berry is **6.13:1 on the page ground and 6.48:1 under white text**. It
passes AA in *both* directions. The orange it replaced (`#E4572E`) managed
3.48:1 and could only ever be a shape.

So in this system the brand colour is **structural, not decorative**: it fills
buttons, carries links and small text, marks the current shelf chip, and draws
illustration. Re-pointing one token family repainted the whole application.

---

## 2. Colour tokens

Contrast is **measured, not eyeballed**. Every figure below is computed against
its real surface. Ground `#FDF8F0`, surface `#FFFFFF`, sunk `#F6EFE3`.

| token | hex | on ground | on white | on sunk | white on it |
|---|---|---|---|---|---|
| `--color-ink` | `#2B2118` | 14.90:1 | 15.75:1 | 13.78:1 | 15.75:1 |
| `--color-ink-soft` | `#5C4F42` | 7.49:1 | 7.92:1 | 6.93:1 | 7.92:1 |
| `--color-ink-faint` | `#6B5D4D` | 6.02:1 | 6.37:1 | 5.57:1 | 6.37:1 |
| `--color-primary` | `#1F6F5C` | 5.70:1 | 6.02:1 | 5.27:1 | 6.02:1 |
| `--color-primary-deep` | `#14574A` | 7.97:1 | 8.43:1 | 7.37:1 | 8.43:1 |
| `--color-accent` (berry) | `#A82878` | 6.13:1 | 6.48:1 | 5.67:1 | 6.48:1 |
| `--color-accent-ink` | `#8C1E63` | 8.01:1 | 8.46:1 | 7.41:1 | 8.46:1 |
| `--color-leaf` | `#78B030` | 2.47:1 | 2.61:1 | 2.28:1 | 2.61:1 |
| `--color-leaf-ink` | `#3F6416` | 6.52:1 | 6.89:1 | 6.03:1 | 6.89:1 |
| `--color-sun` | `#F2C57C` | 1.52:1 | 1.61:1 | 1.41:1 | 1.61:1 |
| `--color-sun-ink` | `#8A5A00` | 5.61:1 | 5.93:1 | 5.19:1 | 5.93:1 |
| `--color-success` | `#2F7D32` | 4.84:1 | 5.12:1 | 4.48:1 | 5.12:1 |
| `--color-warn` | `#8A5A00` | 5.61:1 | 5.93:1 | 5.19:1 | 5.93:1 |
| `--color-danger` | `#B3261E` | 6.18:1 | 6.54:1 | 5.72:1 | 6.54:1 |
| `--color-control-border` | `#8A7C68` | 3.85:1 | 4.07:1 | 3.56:1 | 4.07:1 |
| `--color-hairline` | `#E3D9C9` | 1.32:1 | 1.40:1 | 1.22:1 | 1.40:1 |

**Two colours are shapes only.** `--color-leaf` (2.47:1) and `--color-sun`
(1.52:1) may fill a leaf, a book spine or a rule. They must never sit behind
small text in either direction. Where green or gold *text* is wanted, use
`--color-leaf-ink` or `--color-sun-ink`.

`--color-hairline` is decorative separation only, never a boundary that carries
meaning. `--color-control-border` (3.85:1) is the interactive boundary and
clears the 3:1 rule for non-text contrast.

### Washes

Tinted panels. Ink on every one of them is ≥ 13.3:1.

`--color-primary-wash` `#E8F2EE` · `--color-accent-wash` `#FBEAF3` ·
`--color-sky-wash` `#E7F0F7` · `--color-lavender-wash` `#EFEAF7` ·
`--color-success-wash` `#EAF4EA` · `--color-warn-wash` `#FDF2DF` ·
`--color-danger-wash` `#FCECEB`

### Runtime branding

`--brand-primary` and `--brand-secondary` are written onto `<body>` from
`library_settings` at request time. An administrator changing the primary colour
restyles the application with no deploy. **Nothing downstream hard-codes a brand
colour**, which is also why this file names tokens rather than hex values when
describing components.

---

## 3. Typography

| role | face | why |
|---|---|---|
| display | **Fraunces** variable, weight 600, `SOFT 40` `WONK 1`, `opsz` auto | a low-contrast soft serif from mid-century children's-book lettering. Warm, and it belongs to books |
| body | **Nunito Sans** | tall x-height, unambiguous `a` and `g` — what a six-year-old needs |
| code | system `ui-monospace` | codes and counts only; no web font for eight characters |

Both web faces are self-hosted by `next/font` at build time. **No request ever
leaves a child's browser for a font**, which is a privacy property and the
reason `connect-src` can stay `'self'`.

**Fraunces replaced Quicksand.** Quicksand echoed the wordmark and did it
honestly, but a wide rounded geometric sans at 700 weight and 48px reads as a
craft-fair poster, and the library outgrew that.

### The display face is for headings and nothing else

The old system set navigation, buttons, form labels and table headers in the
display face too. That was the other half of the problem: a characterful face
sprayed across every control makes an interface look like a poster instead of a
place to work. Reserve it and it starts to mean something.

Everything that is not a heading — labels, buttons, navigation, tables, hints —
is Nunito Sans at 600. The one exception is a **book title**, which is the
library's own subject matter and keeps the serif.

### The scale

| token | size |
|---|---|
| `--text-base` | 1.0625rem (17px), line-height 1.6 |
| `--text-lg` | 1.125rem |
| `--text-xl` | 1.25rem |
| `--text-2xl` | 1.5rem |
| `--text-3xl` | 1.75rem |
| `--text-4xl` | 2.125rem |
| `--text-5xl` | 2.625rem |

It came down by about a third. 18px body with a 60px display was a picture book
blown up to fill a laptop: a librarian could see six table rows, and a heading
ate the top of every screen.

**17px is the child-facing floor and it stays above 16px.** The desk steps down
to 16px through one class — see §11.

Headings are weight **600**, not 700: weight was doing the job that size should
have been doing. Tracking `-0.008em` (a serif needs far less negative tracking
than a wide geometric sans), line-height 1.2.

Never set body copy in the display face, and never below 16px anywhere.

---

## 3b. The garden — the ambient layer

One fixed layer of drawings sits behind the whole **reader-facing** application:
a fox, a cat, a rabbit, a bird, a stack of books, sprigs, and the mark's own
butterflies (`components/library/story-characters.tsx`).

Three rules keep it from becoming wallpaper in the bad sense:

1. **It is barely there** — 5% opacity in leaf green, berry and sun. Every
   contrast ratio in this system was measured against the flat ground, and at
   this strength the drawings move none of them.
2. **It never reaches the desk.** Staff screens keep their plain white. A
   librarian is working with a queue of children in front of them.
3. **It is decoration and says so** — `aria-hidden`, no pointer events, and the
   smaller drawings drop out below `sm`.

Each motif is a **silhouette**, and that is a constraint rather than a style: at
5% an eye or a page line disappears and leaves a smudge, while a shape
recognisable by its outline alone still reads. Every part of a drawing overlaps
the mass it belongs to — an ear drawn *beside* a head reads as a floating
triangle. And no two animals share a silhouette: the rabbit's ears are rounded
where the cat's and the fox's are pointed, and the fox is told from the cat by
its snout and the brush of its tail.

---

## 4. The garden rule — the signature

The mark sets its wordmark on a green rule. That rule is lifted and made
structural. It is the one device repeated everywhere, and it is why the
interface reads as belonging to *this* library and no other.

- `.garden-rule` — 5px, 4.5rem wide, `leaf → primary`, under a section heading.
- `.garden-rule-wide` — the same, stretched to 22rem.
- The masthead closes with a 4px full-width `leaf → primary → accent` gradient.
- The staff header uses the same gradient at 2px — same product, quieter room.

Do not invent a second signature. If a page needs to feel like part of the
library, give it the rule.

---

## 5. Icons

**One family, drawn in `src/components/ui/icon.tsx`.** 36 glyphs, no dependency.

- 24×24 grid, `stroke-width: 2`, round caps, round joins, `fill="none"`.
- Painted in `currentColor`, so an icon always matches the text beside it.
- Sized in `em` (`size-[1.15em]`), so it scales with its label.

Accessibility: **decorative and `aria-hidden` by default**, because every icon
in this application sits beside a visible word. Pass `label` only when a glyph
genuinely stands alone; it then renders as `role="img"` with an accessible name.

Empty states, error states and the success panels on the joining, sign-in-help
and email-confirmation screens are drawn from this family too. They each used to
open with a large emoji — a magnifying glass, a party popper, a postbox — which
is three different pictures drawn by three different vendors depending on whose
phone a child is holding. `IconMedallion` is the same moment on all of them, in
the library's own hand.

Two deliberate exceptions, both for the same reason — **the drawn set is for the
interface's own furniture, not for overwriting content somebody else authored.**

1. **Category symbols.** A shelf's emoji is catalogue data a librarian chose
   when they created the category.
2. **Status marks.** The 🟢 / 📕 / 🏠 beside a status word are authored in the
   domain, next to the wording, and are deliberately warm: "🏠 Ready to come
   home" was written *instead of* a red exclamation and a count of overdue days.
   Redrawing them would either mean editing the domain or keeping a second
   status vocabulary in the UI, and the second one would drift.

Celebratory words keep their emoji — "The librarian said yes! 🎉" is a sentence,
not a control, and drawing it would make it colder.

---

## 6. Status is never colour alone

Every `StatusBadge` carries **a colour, a shape mark, and a word**. Any one alone
fails somebody: colour fails a child with a colour vision deficiency, the mark
fails a screen reader (it is `aria-hidden`), and the word never fails anyone.

The same rule governs the book detail panel: the sentence itself says whether the
book can go home today. The green background is confirmation, not information.

---

## 7. Shape, depth, motion

- `--radius-card` 0.875rem · `--radius-field` 0.6rem · `--radius-button` 0.7rem.
- **The fully round button is gone.** A pill is the shape of a toy, and every
  control on the screen being a lozenge was, with the old rounded face, the
  other half of why this looked like a game. Pills survive in exactly two
  places, where they are conventional and mean something: status badges and
  count badges.
- Control borders are 1px, not 2px. `--color-control-border` is 3.85:1, so the
  3:1 boundary rule is met by the colour, not by the thickness. Checkboxes and
  radios keep 2px — a 1px box at 24px reads as empty.
- `--shadow-lift` for resting cards, `--shadow-raise` for hover and heroes. Both
  are warm and soft — lit from a window, not a spotlight.
- `.lift` — a 3px rise on hover. Transform and shadow only; no layout property is
  animated, so it stays cheap on a low-end tablet.
- `.drift` / `.drift-slow` — 7s and 11s, 6px, for butterflies. The page should
  feel alive, not demand attention.

**Reduced motion**: a base rule reduces every animation and transition to 0.01ms
under `prefers-reduced-motion: reduce`, including `scroll-behavior`. Motion is
never the reason a page is unusable.

---

## 8. Buttons

One component, `src/components/ui/button.tsx`.

| variant | treatment |
|---|---|
| `primary` | solid `primary`, white text (6.02:1) |
| `secondary` | outlined berry with `accent-ink` text |
| `quiet` | bordered, no fill |
| `danger` | solid `danger`, white text (6.54:1) |

The berry now passes AA under white, so `secondary` *could* be a solid fill. It
stays outlined on purpose: two solid brand colours side by side give a child no
clue which button is the main one, and half of these sit in admin forms where a
loud pink submit would be wrong.

Sizes are deliberately large — `md` is 56px tall, `lg` is 68px. The smallest
hands using this are five years old, and 44px targets are sized for adult thumbs.

---

## 9. Cards and illustration

`Card` tones: `plain`, `shelf` (berry spine down the left edge), `primary`.

The illustration family lives in `src/components/library/library-logo.tsx`:
`Butterfly` (berry / soft / leaf), `LeafSprig`, `GardenCorner`,
`ShelfIllustration`. All original, all flat-vector.

**They are deliberately a different hand from the mark.** The logo's butterflies
are brush-drawn; copying that stroke would be redrawing somebody else's logo.
Same berry, different technique — family, not forgery.

**Restraint rule: at most three decorative elements per screen.** Whitespace is
part of the design. An empty state gets a berry disc, one butterfly and two faint
sprigs, and nothing else.

---

## 10. Books and their covers

A cover is the only picture on most of these screens, and it is what a child
reads before they read anything else. Four rules, one component each.

### The card

`BookCardTile` shows six things: the cover, the title, the author, the shelf,
the age, and whether the book is here. That is the whole list. A card with ten
pieces of metadata is an inventory row, and a shelf of inventory rows is not
somewhere a nine-year-old wants to spend a Saturday.

The cover gets the card's whole top edge to edge, with the status badge floated
on it. The grid reflows **2 → 3 → 4 → 5** columns and is never a horizontal
scroller.

### Thumbnails, everywhere a book is listed

Every surface that lists a book shows its jacket: the catalogue, a book's own
page, a child's shelf and their history, the librarian's book list, the
circulation picker, the loans table and the asks-to-keep table.

- Child-facing surfaces are already card-shaped, so the cover is large.
- Staff tables get **44px**, inside the existing cell, beside the title. A
  librarian finds the book a child is holding by its jacket long before they
  finish reading the title — but a table of giant images is slower to scan, not
  faster.

The 2:3 box is declared by the container, never by the image, so the space is
reserved before a byte arrives and **a grid of twenty books never reflows as it
loads**. Thumbnails are `loading="lazy"`, `decoding="async"`, `object-cover`.

### When there is no cover

Most books here will never have a photographed jacket — the shelf is stocked by
families, not by a supplier with a metadata feed. **The fallback is the normal
case, not an error state**, and there is exactly one of it: `BookCoverArt`.

A drawn book on a tinted ground, with a leaf growing out of the page — the same
motif as the garden rule. The tint is derived from the title, so the same book
is always the same colour and a shelf of coverless books is not one tile
repeated twelve times. `variant="thumb"` drops the butterfly and the grass,
which at 48px are four pixels of noise.

**It does not carry the title.** It used to, and on a book's own page that put
the same words twice within an inch of each other — once as "art", once as the
heading. Every surface that shows a cover already shows the title beside it.

No broken-image icon can appear, because when there is no cover there is no
`<img>` at all.

### Tap to see it bigger

`CoverThumbnail` wraps a real cover in a button that opens the platform's own
`<dialog>` via `showModal()`. That choice is what makes the accessibility
correct rather than approximated: Escape closes it, focus is trapped inside and
returned to the thumbnail afterwards, and the page behind is inert — all from
the browser, none of it from a key handler that has to be remembered. A visible
Close button and a click on the backdrop do the same thing.

It is not offered where the cover already sits inside a link — the catalogue
tile and the circulation picker row — because a button inside a link is invalid
HTML that no two browsers agree on, and there the click already goes somewhere
useful. It is not offered on the drawn fallback either: a button promising a
bigger drawing of a book would be a promise the library cannot keep.

### Keeping covers small

A librarian photographs a jacket on a phone and gets 4 MB at 4000 pixels wide.
Two changes, both simple, neither weakening anything:

**Shrunk in the browser, before upload** (`src/lib/image-downscale.ts`). Longest
edge 1400 — the viewer caps at 28rem, so 1344 device pixels on a 3× screen is
the most that is ever needed. The canvas re-encode also applies the EXIF
orientation tag and then discards it, so a photograph taken at home never
carries its coordinates off the device at all.

This is a **courtesy, never a control**. Anyone can post the form without
running it. The size cap, the magic-byte check, the executable refusal, the
metadata strip and the generated storage key all still run on the server against
the bytes that actually arrive. Every failure path returns the original file: a
librarian with a queue in front of them is never stopped by an image codec.

**Revalidated rather than re-sent.** `/api/media/[id]` gives covers and logos an
`ETag` and `Cache-Control: private, no-cache, must-revalidate`, so a second view
of the same jacket costs an empty 304. `no-cache` — not `max-age` — is what
makes that safe: the browser must ask, so **the authorization check runs on
every single request, exactly as before**. The list of purposes this applies to
lives in `src/server/lib/uploads.ts` and is unit-tested. A child's photograph is
not on it and must never be: it keeps `no-store`.

### What is never done to a cover

- **No `next/image`.** The optimiser serves resized output from
  `/_next/image?url=…`, a URL with no session on it. Putting a member-only cover
  behind that cache would hand out an unauthenticated way to read it. Covers
  are kept small at upload instead.
- **No public URL, no signed URL, no storage path** — in the page, in the
  viewer, or anywhere else. Enlarging a cover asks the same authorised route the
  same question a second time.
- **No second storage system.** One Blob store, one media abstraction, one
  stored representation per cover.

---

## 11. Performance

- Covers are the only images: sized at upload, lazily loaded, revalidated.
- The full-cover viewer is the **only** client component added by this work; the
  catalogue, book detail and every staff table remain server-rendered.
- No animation library. Motion is four CSS rules, all transform-only, all
  switched off under `prefers-reduced-motion`.
- Fonts are self-hosted by `next/font`, so no request leaves a child's browser
  for one.
- Search, filtering, sorting and paging run in PostgreSQL. The browser is never
  handed the catalogue to sift through.

---

## 12. The logo

Order of preference:

1. a logo an administrator uploaded on the branding screen — always wins;
2. the mark packaged with the deployment at `public/brand/library-mark.png`.

The packaged file is a **deployment asset, not a platform default**: it lives in
`public/`, never in `src/`, so the branding lint rule stays true and another
community replaces one file or uploads their own.

Aspect is 640 × 690 and is preserved by `LibraryLogo` on every use. Never crop,
recolour or restretch it.

> **Note on the supplied artwork.** The "transparent" PNG originally shipped with
> a fully opaque white background (alpha 255 across 76.6% near-white pixels), so
> it showed a white box on the cream ground. The white field was keyed to real
> alpha with a soft band to preserve anti-aliased edges. Colours, artwork and
> proportions are untouched.

---

## 13. Child vs staff

Same system, different volume.

| | child-facing | staff |
|---|---|---|
| ground | warm paper with grain | plain white |
| body | 17px | 16px, via `.desk-density` on the shell |
| headings | up to 2.625rem | 1.875rem, with the rule |
| width | a reading measure | `max-w-[104rem]` — a table is scanned across, not read |
| decoration | the garden layer, butterflies, sprigs | the header rule, and nothing else |
| density | generous, two columns | compact, tables where genuinely useful |
| language | "My books", "Ask to Keep Longer" | "Books out", "Asks to keep" |

Librarians are working, often with a queue of children in front of them. The
children's visual language would slow them down. Admin screens carry the same
logo, colour, type and buttons, and drop the illustration.

Child-facing vocabulary is a hard rule: **"My books", never "Loan Management";
"Ask to Keep Longer", never "Renewal Transaction".**

---

## 14. Responsive

Breakpoints follow Tailwind: `sm` 640, `md` 768, `lg` 1024, `xl` 1280.

- **Mobile is first-class**, not a shrunken desktop. Verified at 375px.
- **No page-level horizontal overflow, anywhere.** `documentElement.scrollWidth`
  must equal `clientWidth`.
- Decorative overhangs are clipped by `overflow-hidden` on their own section, so
  a drifting butterfly can never widen the page.
- The catalogue grid reflows 2 → 3 → 4 → 5 columns. It is never a horizontal
  scroller: on a tablet that hides half the library behind a gesture a
  seven-year-old will not discover.
- **The masthead is capped at four doors.** Adding a fifth is what pushed the
  page past 375px in Phase 3. The donors page is reached from the home page and
  the footer instead.
- A table that cannot fit scrolls **inside its own container**, never the page.

---

## 15. Accessibility

- A visible 3px focus ring on everything (`:focus-visible`), offset 3px. Adults
  operate the desk by keyboard; this is not optional decoration. Never remove an
  outline without replacing it.
- A skip link is the first thing a keyboard user meets.
- Decorative SVG is `aria-hidden` and `focusable="false"`.
- Status never relies on colour (§6).
- Every input has a real `<label>`; placeholders are never labels.
- Error text is `role="alert"`; live results are `role="status"`.
- Contrast targets: 4.5:1 for body text, 3:1 for large text and interactive
  boundaries. §2 records what each token actually achieves.
- The full-cover viewer is a native `<dialog>` opened with `showModal()`, so
  Escape, the focus trap, the focus return and the inert background come from
  the browser rather than from code that could forget one of them. Its trigger
  carries an accessible name naming the book; the picture inside is a real
  `alt`, not a decorative one, because it is the content at that moment.


---

## Elevation, edges and the way in (second pass, 2026-09-05)

See ADR-069. Three rungs, each carrying a one-pixel hairline of the ink at 7%:

| token | use |
|---|---|
| `--shadow-hairline` | an edge with no lift — wells, the masthead's underline |
| `--shadow-card` | every `Card`, every desk table (`.desk-plate`) |
| `--shadow-float` | the sign-in frame, the specimen card in the hero |

Behaviours that live in `globals.css` rather than in a component:

* `.masthead` — sticky from 768px up, 88% white, blurred through.
* `.door[aria-current="page"]` — the berry-to-green underline under the
  current door. Set by `NavLink`; never by a class alone.
* `.field-input` — hover darkens the border; focus turns it deep primary and
  adds a 4px wash ring *inside* the page's focus outline, which stays.
* `.segment` — two native radios drawn as a segmented control; the checked
  one lifts on a white plate (`:has(input:checked)`).
* `.auth-panel` — the deep primary room behind the sign-in, lit berry high
  and leaf low, faintly ruled.
* `.hero-light` — one warm pool behind the headline, one cool one behind the
  card. Under 12%, so the paper grain still shows.
