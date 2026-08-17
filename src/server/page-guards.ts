import "server-only";

import { redirect } from "next/navigation";

import { getActor, type Actor } from "@/server/authz";
import type { PermissionKey } from "@/lib/permissions";

/**
 * Page-level guards.
 *
 * These exist purely so that a person who reaches a page they may not see gets
 * a sensible screen instead of a crash. A child who taps a stale link to the
 * librarian's desk should land back in their own library, not on
 * "Oops! Something went wrong."
 *
 * THEY ARE NOT THE SECURITY BOUNDARY. Every service call behind these pages
 * still calls `requirePermission()` and still throws. This is the difference
 * between "denied" and "denied politely" — the deny already happened.
 *
 * Kept out of @/server/authz deliberately: services must never import routing.
 */

export async function requirePermissionForPage(
  permission: PermissionKey,
  options: { signedOutTo?: string; deniedTo?: string } = {},
): Promise<Actor> {
  const actor = await getActor();

  if (!actor) {
    redirect(options.signedOutTo ?? "/login");
  }

  if (!actor.permissions.has(permission)) {
    // Back to their own library, which is the only place they were ever
    // supposed to be.
    redirect(options.deniedTo ?? "/account");
  }

  return actor;
}

export async function requireAnyPermissionForPage(
  permissions: readonly PermissionKey[],
  options: { signedOutTo?: string; deniedTo?: string } = {},
): Promise<Actor> {
  const actor = await getActor();

  if (!actor) {
    redirect(options.signedOutTo ?? "/login");
  }

  if (!permissions.some((permission) => actor.permissions.has(permission))) {
    redirect(options.deniedTo ?? "/account");
  }

  return actor;
}
