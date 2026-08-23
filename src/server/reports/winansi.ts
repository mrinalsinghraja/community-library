import "server-only";

/**
 * The characters a standard PDF font can actually draw.
 *
 * The fourteen built-in faces are encoded in WinAnsi, which is Latin-1 plus a
 * short list of typographic extras. A book title written in Kannada, Assamese
 * or Devanagari is not in it, and `drawText` throws rather than guessing — so
 * text has to be filtered before it reaches the page or one title takes the
 * whole document down.
 *
 * Filtering loses information, which is why every caller is handed `lost` and
 * expected to say so on the page. Silently replacing somebody's book with
 * question marks and handing over the file is the one behaviour that is not
 * acceptable.
 *
 * Shared by the table export and the label sheet. It lived inside the table
 * writer until the labels needed exactly the same rule, and two copies of an
 * encoding table is two chances to fix a bug once.
 */

const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isDrawable(code: number): boolean {
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(code);
}

export interface Sanitised {
  text: string;
  /** True when at least one character was dropped rather than drawn. */
  lost: boolean;
}

export function winAnsi(value: string): Sanitised {
  let text = "";
  let lost = false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (isDrawable(code)) {
      text += character;
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      text += " ";
    } else {
      lost = true;
    }
  }
  return { text, lost };
}
