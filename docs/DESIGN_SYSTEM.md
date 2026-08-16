# The Reading Corner — design system

A warm paper-and-ink world that works for a six-year-old still decoding words
and a fourteen-year-old who would be embarrassed by anything babyish.

Not: primary-colour plastic, cartoon mascots, bouncing everything.
Not: enterprise software with a rounded corner bolted on.

---

## 1. Colour — measured, not eyeballed

Every pair below was computed against its real surface. Child-friendly palettes
fail contrast constantly, which is exactly why this table exists.

| Token | Hex | On cream (#FDF8F0) | Verdict |
|---|---|---|---|
| `ink` | `#2B2118` | **14.90:1** | body text |
| `ink-soft` | `#5C4F42` | **7.49:1** | secondary text |
| `ink-faint` | `#6B5D4D` | 6.37:1 on white | placeholders only |
| `primary` | `#1F6F5C` | **5.70:1** (white on it: 6.02:1) | text and fills |
| `primary-deep` | `#14574A` | **7.97:1** | hover, focus ring, emphasis |
| `accent` | `#E4572E` | **3.48:1** | ⚠ **shapes only** |
| `accent-ink` | `#B23A16` | **5.66:1** | the text-safe accent |
| `control-border` | `#8A7C68` | 3.85:1 | interactive boundaries (needs ≥3:1) |
| `hairline` | `#E3D9C9` | 1.32:1 | decorative separators only |
| `success` | `#2F7D32` | 5.12:1 on white | |
| `warn` | `#8A5A00` | 5.61:1 | |
| `danger` | `#B3261E` | 6.18:1 | |

### The rule that matters most

**`--color-accent` (#E4572E) never carries text — in either direction.**
It is 3.48:1 on cream and 3.68:1 under white. It is a *shape* colour: fills,
spines, illustration, the shelf-edge motif. Where accent-coloured text is
wanted, use `--color-accent-ink`.

This is why the secondary button is an outlined treatment rather than an orange
fill with white text, which would have shipped at 3.68:1.

Likewise `hairline` at 1.32:1 is fine for a decorative rule and wrong for the
edge of an input — inputs use `control-border`.

## 2. Type

- **Display:** Baloo 2 — rounded, warm, still grown-up at heavier weights.
- **Body:** Nunito Sans — open counters, high legibility at size.

Both self-hosted by `next/font` at build time, so no request leaves a child's
browser for a font. That is a privacy property as much as a performance one, and
it is why `connect-src` can stay `'self'`.

**Body text starts at 18px, not 16px.** These readers are still learning.

## 3. Shape and space

| Token | Value | Used for |
|---|---|---|
| `--radius-card` | 20px | cards |
| `--radius-button` | full | every button |
| `--radius-field` | 14px | inputs, callouts |
| `--shadow-lift` | soft, warm | resting cards |
| `--shadow-raise` | deeper | the hero, emphasis |

Shadows are warm-tinted (`rgb(43 33 24 / …)`), never neutral grey — grey shadows
on cream read as dirt.

## 4. Touch targets

| Size | Height | Where |
|---|---|---|
| `sm` | 44px | dense admin surfaces |
| `md` | 56px | default |
| `lg` | 68px | primary child-facing actions |

Larger than typical on purpose: 44px is sized for adult thumbs, and the smallest
hands here are five years old.

## 5. Motifs — exactly two

1. **The shelf edge** (`.shelf-edge`) — a rule under a section heading with an
   accent segment at its left, like a shelf label.
2. **The spine** — `Card tone="shelf"` puts an accent bar down a card's left
   edge.

Used sparingly. If every card has a spine, none of them mean anything.

The hero illustration is the same idea drawn properly: a row of books of
differing heights, one lying flat on top, on a plank with brackets. Geometric,
not cartoon.

## 6. Accessibility rules

- **Status is never colour alone.** Every `StatusBadge` pairs its colour with a
  word and a shape mark (`●○◐◆`).
- **Icons never travel alone.** Every action carries an icon *and* a word — a
  five-year-old reads the icon, a nine-year-old reads the word. Icons are
  `aria-hidden`.
- **Focus is always visible:** 3px `primary-deep` outline with a 3px offset, on
  everything, never removed without replacement.
- **Real labels.** A placeholder is never a label. Errors are wired with
  `aria-describedby` + `aria-invalid` and use words, not colour.
- **A skip link** is the first focusable element on every page.
- **`prefers-reduced-motion`** collapses all animation and transition.
- Verified: no horizontal overflow at 375px.

## 7. Voice

| Instead of | We say |
|---|---|
| Inventory / Acquisition | Books / New Books |
| Circulation | Books on Loan |
| Patron / Borrower | Reader |
| Due date | "Yours until Saturday 30 August" |
| Overdue | "Ready to come home 🏠" |
| HTTP 500 | "Oops! Something went wrong. Please ask your librarian for help." |
| Authentication failed | "That didn't work. Check the spelling and try again." |

There are no fines in this library and no copy may imply otherwise. A unit test
asserts the late-book wording contains no "overdue", "fine", "penalty" or
"late fee".

Admin surfaces may use professional terminology and dense tables — different
audience, different tool. The design system supports both; it does not force the
children's voice onto a librarian's workflow screen.

## 8. Theme

Light only, deliberately. A children's library is a bright room. The palette is
committed rather than duplicated across two themes that would both need
measuring.

## 9. Runtime branding

`--brand-primary` and `--brand-secondary` are injected into `<body>` from
`library_settings`. A Super Admin changing the primary colour restyles the
application with no deploy and no rebuild. Nothing downstream hard-codes a brand
colour, and a database CHECK rejects any value that is not `#rrggbb` — a bad
colour there would otherwise break every page at once.
