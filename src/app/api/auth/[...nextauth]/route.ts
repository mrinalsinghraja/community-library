import { handlers } from "@/server/auth";

/**
 * Auth.js route handler.
 *
 * Must run on the Node.js runtime: argon2 is a native binding and Prisma needs a
 * TCP connection, neither of which exist on the edge runtime.
 */
export const runtime = "nodejs";

export const { GET, POST } = handlers;
