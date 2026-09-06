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

/**
 * How many times an image is painted, across the whole document.
 *
 * `Do` invokes an XObject, so this counts placements rather than embedded
 * copies — which is the pair of facts a label sheet needs kept apart: one
 * drawing embedded, and one placement per sticker.
 */
export function drawnImageCount(bytes: Buffer): number {
  let count = 0;
  for (const content of contentStreams(bytes)) {
    count += [...content.matchAll(/\/[A-Za-z0-9_.-]+\s+Do\b/g)].length;
  }
  return count;
}

/**
 * Every flate stream in a document, inflated.
 *
 * Each one is sliced by the `/Length` in its own dictionary rather than by
 * hunting forward for `endstream`, because a stream's payload is arbitrary
 * bytes: an embedded PNG contains the word `endstream` often enough, and one
 * false match desynchronises the scan so completely that the page's own
 * content stream is never reached. That failed silently as an empty document —
 * a test asking "is the title printed" would have answered no for every label
 * on a sheet that was in fact perfect.
 */
/**
 * How big each image is actually painted, in PDF points.
 *
 * pdf-lib wraps an image in `q … Do Q` and writes several `cm` matrices inside
 * it — a translate, a scale, and identities between them — so the drawn size is
 * the product of their scale factors rather than any one of them. Multiplying
 * is exact and needs no guess about which matrix is which; reading only the
 * first one gives 1 x 1 and quietly passes any aspect assertion made about it.
 *
 * The drawn size is what a squashed logo shows up in. Inspecting the embedded
 * pixels would not: those stay the right shape however badly they are scaled.
 */
export function drawnImageBoxes(bytes: Buffer): { width: number; height: number }[] {
  const boxes: { width: number; height: number }[] = [];
  for (const content of contentStreams(bytes)) {
    for (const block of content.matchAll(/q([\s\S]{0,400}?)\/[A-Za-z0-9_.-]+\s+Do\b/g)) {
      let width = 1;
      let height = 1;
      for (const cm of block[1].matchAll(/([\d.-]+) 0 0 ([\d.-]+) [\d.-]+ [\d.-]+ cm/g)) {
        width *= Number(cm[1]);
        height *= Number(cm[2]);
      }
      boxes.push({ width, height });
    }
  }
  return boxes;
}

function* contentStreams(bytes: Buffer): Generator<string> {
  const raw = bytes.toString("latin1");
  let at = 0;

  for (;;) {
    const start = raw.indexOf("stream", at);
    if (start === -1) return;

    // `endstream` ends in `stream`; landing on one is not a new stream.
    if (raw.startsWith("endstream", start - 3)) {
      at = start + "stream".length;
      continue;
    }

    let from = start + "stream".length;
    if (raw.charCodeAt(from) === 13) from += 1;
    if (raw.charCodeAt(from) === 10) from += 1;

    const dict = raw.lastIndexOf("<<", start);
    const declared = dict === -1 ? null : /\/Length\s+(\d+)/.exec(raw.slice(dict, start))?.[1];
    const end = declared ? from + Number(declared) : raw.indexOf("endstream", from);
    if (end === -1 || end > raw.length) return;

    try {
      yield inflateSync(Buffer.from(raw.slice(from, end), "latin1")).toString("latin1");
    } catch {
      // Not a flate stream (a font, an object stream) — skip it.
    }
    at = end;
  }
}
