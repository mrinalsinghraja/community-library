import "server-only";

import { pingDatabase } from "@/server/db";

/**
 * Health reporting for the liveness endpoint.
 *
 * This exists so that the route handler does not import the database client
 * directly — the layering rule in eslint.config.mjs forbids it, and the rule is
 * right: routes call services, services call the database.
 */
export interface HealthReport {
  status: "ok" | "degraded";
  databaseReachable: boolean;
}

export async function getHealthReport(): Promise<HealthReport> {
  const databaseReachable = await pingDatabase();
  return { status: databaseReachable ? "ok" : "degraded", databaseReachable };
}
