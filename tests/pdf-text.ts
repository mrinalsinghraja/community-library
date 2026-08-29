import { inflateSync } from "node:zlib";

/**
 * Reading a finished PDF back.
 *
 * Shared by the unit tests and the database tests, because both make the same
 * claim about the same files — that a label carries what it is supposed to
 * carry, and nothing it is not — and that claim is only worth anything if it is
 * checked against the bytes rather than against the drawing code.
 *
 * pdf-lib flate-compresses its content streams and writes every string as
 * `<hex> Tj`, so both have to be undone before a word can be looked for.
 */

/** Every drawn string in a document, one per line, in drawing order. */
export function drawnText(bytes: Buffer): string {
  let drawn = "";
  for (const content of contentStreams(bytes)) {
    for (const match of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      drawn += `${Buffer.from(match[1], "hex").toString("latin1")}\n`;
    }
  }
  return drawn;
}

/**
 * Where each drawn string sits, in PDF points from the bottom of the page.
 *
 * pdf-lib writes a text matrix and then the string, so the two are read as a
 * pair. This is how "did the last line stay inside its label" gets answered by
 * the file instead of by repeating the renderer's own arithmetic in a test.
 */
export function drawnBaselines(bytes: Buffer): number[] {
  const baselines: number[] = [];
  for (const content of contentStreams(bytes)) {
    for (const match of content.matchAll(
      /1 0 0 1 [\d.-]+ ([\d.-]+) Tm[\s\S]{0,400}?<[0-9A-Fa-f]+>\s*Tj/g,
    )) {
      baselines.push(Number(match[1]));
    }
  }
  return baselines;
}

function* contentStreams(bytes: Buffer): Generator<string> {
  const raw = bytes.toString("latin1");
  let at = 0;

  for (;;) {
    const start = raw.indexOf("stream", at);
    if (start === -1) return;

    let from = start + "stream".length;
    if (raw.charCodeAt(from) === 13) from += 1;
    if (raw.charCodeAt(from) === 10) from += 1;

    const end = raw.indexOf("endstream", from);
    if (end === -1) return;

    try {
      yield inflateSync(Buffer.from(raw.slice(from, end), "latin1")).toString("latin1");
    } catch {
      // Not a flate stream (a font, an object stream) — skip it.
    }
    at = end + 1;
  }
}
