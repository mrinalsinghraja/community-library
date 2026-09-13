import type { MetadataRoute } from "next";

/**
 * What a well-behaved crawler may fetch (ADR-072).
 *
 * Every page already says `noindex` in its metadata, but a crawler has to
 * download a page to read that -- and every one it downloads, and every cover
 * on it, is Fast Origin Transfer this library pays for on a shared Hobby team.
 * This file stops the fetch itself for everything no search result should ever
 * point at:
 *
 * - `/api/` -- media bytes, report exports, cron endpoints;
 * - `/desk`, `/admin` -- staff screens;
 * - `/account`, `/my-*` -- one family's own pages;
 * - `/verify`, `/reset`, `/activate` -- single-use token links. A crawler that
 *   followed one would be spending somebody's link, not reading a page;
 * - `/dev` -- local tooling.
 *
 * The public pages stay allowed. It is a request, not a lock: the routes above
 * make their own authorization decisions regardless.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/desk",
          "/admin",
          "/account",
          "/my-",
          "/verify",
          "/reset",
          "/activate",
          "/dev",
        ],
      },
    ],
  };
}
