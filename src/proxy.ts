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

/** Signed-in users have no reason to see these. */
const AUTH_ONLY_PREFIXES = ["/login"] as const;

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

  if (signedIn && AUTH_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.redirect(new URL("/", request.url));
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
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico|avatars|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
