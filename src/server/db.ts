import "server-only";

import { PrismaClient } from "@prisma/client";

import { env, isProduction } from "@/server/env";

/**
 * Single Prisma client for the process.
 *
 * Next.js dev mode re-evaluates modules on every hot reload, which would leak a
 * new connection pool each time; stashing the client on globalThis avoids that.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ["warn", "error"] : ["warn", "error"],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

export type { Prisma } from "@prisma/client";

/** Cheap liveness probe used by /api/health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export const databaseUrlIsConfigured = Boolean(env.DATABASE_URL);
