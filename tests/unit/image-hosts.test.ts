import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

/**
 * Pictures come from this site and nowhere else.
 *
 * Every stored image is private and reaches a page through /api/media, so no
 * storage host needs naming — and a wildcard like *.public.blob.vercel-storage.com
 * names every public Blob store on Vercel, not ours. Both the image optimiser's
 * allow-list and the page's img-src are pinned here.
 */
describe("image hosts", () => {
  it("lets the image optimiser fetch from no remote host", () => {
    expect(nextConfig.images?.remotePatterns ?? []).toEqual([]);
    expect(nextConfig.images?.domains ?? []).toEqual([]);
  });

  it("lets it resize only the two paths that hold pictures", () => {
    expect(nextConfig.images?.localPatterns).toEqual([
      { pathname: "/brand/**" },
      { pathname: "/api/media/**" },
    ]);
  });

  it("gives the page's img-src no remote host either", () => {
    const proxy = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
    const imgSrc = proxy.match(/"img-src ([^"]*)"/)?.[1];

    expect(imgSrc).toBe("'self' blob: data:");
  });
});
