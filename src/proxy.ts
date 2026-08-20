import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge proxy (formerly `middleware.ts`, renamed in Next.js 16): a cheap first
 * gate and the Content-Security-Policy.
 *
 * What this is NOT: authorization. Middleware runs on the edge runtime with no
 * database access, so it can only see whether a session cookie is *present* —
 * not whether it is valid, unexpired, or attached to an active account. A
 * forged cookie sails straight through here.
 *
 * The real check happens server-side in `getActor()` and `requirePermission()`
 * on every protected read and every mutation. This layer exists so that a
 * signed-out visitor gets a tidy redirect instead of an error page.
 */

const SESSION_COOKIE_NAMES = ["__Host-library.session", "library.session"] as const;

/** Route prefixes that require *some* session. Permissions are checked later. */
const PROTECTED_PREFIXES = ["/reader", "/desk", "/admin", "/account"] as const;

/*
 * There is deliberately no "bounce a signed-in visitor away from /login" rule
 * here any more, and removing it fixed a real lock-out.
 *
 * This layer can only see that a cookie *exists*. A session whose idle window
 * has passed leaves a perfectly good-looking cookie in the browser and no live
 * row behind it, and the bounce then produced a loop with no way out:
 *
 *   /account  → page resolves no actor → redirect /login
 *   /login    → cookie present → redirect /
 *   /         → "My library" → /account → …
 *
 * A child whose session had simply gone idle could not reach the sign-in form
 * at all. The check belongs where the answer is known: the login page resolves
 * the actual session and redirects only a genuinely signed-in visitor.
 */

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(request.cookies.get(name)?.value));
}

function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind compiles to a real stylesheet, but Next injects a small amount of
    // inline style for streaming and route transitions.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.public.blob.vercel-storage.com",
    "font-src 'self' data:",
    // No third-party analytics, no ad networks, no tracking pixels: children's
    // screens must not talk to anyone but us.
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export default function proxy(request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const { pathname, search } = request.nextUrl;

  const signedIn = hasSessionCookie(request);

  if (!signedIn && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = new URL("/login", request.url);
    // Only ever a same-origin path, so this cannot become an open redirect.
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(nonce, isDev));
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation, which need no
     * gate and would only pay the cost.
     *
     * `api/media` is excluded for a different reason: this middleware sets the
     * page Content-Security-Policy on every response it touches, which would
     * overwrite the far stricter `default-src 'none'; sandbox` that the media
     * route sets on the bytes it serves. Serving a child's photograph under the
     * *application's* script policy is not what that route intends, and it does
     * its own authorization on every request, so it needs nothing from here.
     *
     * `api/reports` is excluded for exactly that reason too. A PDF is an active
     * document format, and the bytes of an exported list of children go out
     * under the same `default-src 'none'; sandbox` the route sets for itself.
     * It also authorises every request twice over — `report.view`, then the
     * permission the underlying screen demands — so the cookie-presence check
     * here would add nothing but a redirect an API caller cannot follow.
     */
    {
      source: "/((?!api/media|api/reports|_next/static|_next/image|favicon.ico|avatars|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
