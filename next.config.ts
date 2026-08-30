import type { NextConfig } from "next";

/**
 * Security headers that do not need a per-request nonce live here.
 * The Content-Security-Policy is set in src/middleware.ts because it does.
 */
const securityHeaders = [
  // Do not let a browser guess that a .jpg is really a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt and braces alongside CSP frame-ancestors, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This application has no use for any of these, and children's devices should
  // never be asked for them on our behalf.
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "interest-cohort=()",
      "browsing-topics=()",
      "payment=()",
      "usb=()",
    ].join(", "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /*
   * How big a form submission may be.
   *
   * Next.js defaults this to 1 MB, which is smaller than a photograph taken on
   * any phone made this decade — and a body over the limit is refused by the
   * framework *before* the Server Action runs, so no catch block in this
   * application can turn it into a sentence. What a parent sees instead is the
   * whole-page "something went wrong", which is what happened to a family
   * registering their child from a phone.
   *
   * 4 MB, because Vercel refuses a request body over 4.5 MB before our code is
   * reached at all; a limit above that would move the same failure rather than
   * fix it. Every upload rule in `src/server/lib/uploads.ts` sits below this
   * with room for the rest of the form, and `tests/unit/upload-limits.test.ts`
   * fails if one is ever raised past it.
   */
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },

  // A type error must fail the build, not ship to families. (Next 16 no longer
  // runs ESLint during `next build`; CI runs `npm run lint` as its own gate.)
  typescript: { ignoreBuildErrors: false },

  // Never advertise the framework version.
  poweredByHeader: false,

  images: {
    // Only our own Blob store. No remote image host may be added without a
    // deliberate change here.
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
