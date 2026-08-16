import "server-only";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { env, isProduction } from "@/server/env";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { fakeVerifyDelay, verifyPassword } from "@/server/lib/password";
import { checkLoginThrottle, recordLoginAttempt } from "@/server/lib/rate-limit";
import {
  createSession,
  revokeSessionByToken,
} from "@/server/auth/session-store";

/**
 * Auth.js configuration.
 *
 * Auth.js is responsible for the sign-in route, CSRF protection and encrypting
 * the cookie. It is NOT responsible for deciding whether a request is
 * authorized — that lives in @/server/authz and is always re-checked against the
 * database. The token below carries a single opaque claim, `sid`.
 */

/** The single identifying claim we put in the cookie. Nothing else belongs here. */
declare module "next-auth" {
  interface User {
    /** Raw session handle minted during authorize(). Never persisted. */
    sessionHandle?: string;
  }
  interface Session {
    sessionHandle?: string;
  }
}

/**
 * The token is treated as untyped on purpose. Augmenting next-auth/jwt couples
 * us to a beta package's internal module layout; reading the one claim we put
 * there through a narrow helper is both simpler and safer.
 */
function readSessionHandle(token: unknown): string | undefined {
  const sid = (token as { sid?: unknown } | null | undefined)?.sid;
  return typeof sid === "string" ? sid : undefined;
}

/**
 * The single message shown for every failed sign-in.
 *
 * It must not distinguish "no such reader", "wrong secret word", "account
 * suspended" or "too many tries" — any of those would let someone confirm that
 * a particular member code belongs to a real child.
 */
export const GENERIC_LOGIN_FAILURE = "That didn't work. Check the spelling and try again.";

function normaliseIdentifier(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Finds a user by either login identity: a library card code (MJCL-R0042) or a
 * username (aarav15). Staff sign in with their email address, which is matched
 * by the same lookup.
 */
async function findUserByIdentifier(identifier: string) {
  const memberByCode = await prisma.memberProfile.findFirst({
    where: { memberCode: { equals: identifier, mode: "insensitive" } },
    select: { user: true },
  });
  if (memberByCode?.user) return memberByCode.user;

  return prisma.appUser.findFirst({
    where: {
      OR: [{ username: identifier }, { email: identifier }],
    },
  });
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: true,

  session: {
    /**
     * The Credentials provider always issues a cookie-borne token; native
     * database sessions are unreachable from it (see session-store.ts). The
     * cookie therefore holds only an opaque handle that is resolved against the
     * `session` table on every request. maxAge is an upper bound only — the
     * database row is the real authority on expiry.
     */
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },

  cookies: {
    sessionToken: {
      // __Host- is the strictest cookie prefix: it requires Secure, Path=/ and
      // forbids a Domain attribute, so a subdomain cannot set or read it.
      name: isProduction ? "__Host-library.session" : "library.session",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [
    Credentials({
      credentials: {
        identifier: { label: "Library card or username", type: "text" },
        password: { label: "Secret word", type: "password" },
      },

      async authorize(rawCredentials, request) {
        const identifier = normaliseIdentifier(rawCredentials?.identifier);
        const password =
          typeof rawCredentials?.password === "string" ? rawCredentials.password : "";

        if (!identifier || !password) return null;

        const ip = extractClientIp(request);

        // Check the throttle before doing any expensive work, so a locked
        // identifier costs an attacker a cheap query rather than a hash.
        const throttle = await checkLoginThrottle(identifier, ip);
        if (!throttle.allowed) {
          await recordLoginAttempt({ identifier, ip, succeeded: false });
          return null;
        }

        const user = await findUserByIdentifier(identifier);

        if (!user || !user.passwordHash) {
          // Burn comparable CPU so response timing does not reveal whether the
          // identifier exists.
          await fakeVerifyDelay();
          await recordLoginAttempt({ identifier, ip, succeeded: false });
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await recordLoginAttempt({ identifier, ip, succeeded: false, libraryId: user.libraryId });
          return null;
        }

        const passwordMatches = await verifyPassword(user.passwordHash, password);

        if (!passwordMatches) {
          await recordLoginAttempt({ identifier, ip, succeeded: false, libraryId: user.libraryId });
          await prisma.appUser.update({
            where: { id: user.id },
            data: { failedLoginCount: { increment: 1 } },
          });
          await recordAudit(prisma, {
            libraryId: user.libraryId,
            action: AUDIT_ACTIONS.LOGIN_FAILED,
            entityType: "app_user",
            entityId: user.id,
            actorUserId: null,
            actorLabel: "anonymous",
            metadata: { reason: "bad_password" },
            ipHash: null,
          });
          return null;
        }

        // Correct password, but the account is not usable. Deliberately the same
        // outcome as a wrong password from the caller's point of view.
        if (user.status !== "ACTIVE") {
          await recordLoginAttempt({ identifier, ip, succeeded: false, libraryId: user.libraryId });
          await recordAudit(prisma, {
            libraryId: user.libraryId,
            action: AUDIT_ACTIONS.LOGIN_FAILED,
            entityType: "app_user",
            entityId: user.id,
            actorUserId: null,
            actorLabel: user.displayName,
            metadata: { reason: "status_not_active", status: user.status },
            ipHash: null,
          });
          return null;
        }

        const sessionHandle = await createSession(user.id, user.kind, {
          userAgent: request?.headers?.get("user-agent") ?? null,
          ip,
        });

        await prisma.appUser.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        });

        await recordLoginAttempt({ identifier, ip, succeeded: true, libraryId: user.libraryId });
        await recordAudit(prisma, {
          libraryId: user.libraryId,
          action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
          entityType: "app_user",
          entityId: user.id,
          actorUserId: user.id,
          actorLabel: user.displayName,
          metadata: { kind: user.kind },
          ipHash: null,
        });

        return { id: user.id, sessionHandle };
      },
    }),
  ],

  callbacks: {
    /**
     * The token is reduced to a single opaque claim. No name, no email, no
     * roles: anything cached in a cookie is something that cannot be revoked.
     */
    async jwt({ token, user, trigger }) {
      if (trigger === "signIn" && user?.sessionHandle) {
        return { sid: user.sessionHandle };
      }
      const handle = readSessionHandle(token);
      return handle ? { sid: handle } : {};
    },

    /**
     * Passes the handle through. Callers must not treat this as proof of
     * anything — `getActor()` in @/server/authz resolves it against the database.
     */
    async session({ session, token }) {
      session.sessionHandle = readSessionHandle(token);
      return session;
    },
  },

  events: {
    async signOut(message) {
      const handle = "token" in message ? readSessionHandle(message.token) : undefined;
      if (handle) await revokeSessionByToken(handle);
    },
  },
});

/**
 * Best-effort client IP. Behind Vercel, x-forwarded-for is set by the platform;
 * the leftmost entry is the client. Used only for throttling and stored hashed,
 * so a spoofed value costs an attacker their own rate-limit bucket.
 */
function extractClientIp(request: Request | undefined): string | null {
  const forwarded = request?.headers?.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request?.headers?.get("x-real-ip") ?? null;
}
