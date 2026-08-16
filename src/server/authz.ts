import "server-only";

import { cache } from "react";
import type { UserKind } from "@prisma/client";

import { auth } from "@/server/auth";
import { resolveSession } from "@/server/auth/session-store";
import { prisma } from "@/server/db";
import type { PermissionKey } from "@/lib/permissions";
import { NotAuthenticatedError, NotAuthorizedError, NotFoundError } from "@/server/lib/errors";

/**
 * The authorization layer.
 *
 * Three rules, applied without exception:
 *
 *   1. Permissions are read from the database on every request. Nothing is
 *      cached in the cookie, so a revoked grant takes effect immediately.
 *   2. Ownership is decided from the *session*, never from the request. A child
 *      asking for `/api/whatever?memberId=<someone else>` gets their own record
 *      or a 404 — the id in the URL is not consulted for identity.
 *   3. Hiding a button is not authorization. Every service entry point calls
 *      `requirePermission` regardless of what the UI did.
 */

export interface Actor {
  userId: string;
  libraryId: string;
  kind: UserKind;
  displayName: string;
  mustSetPassword: boolean;
  permissions: ReadonlySet<PermissionKey>;
  roleKeys: readonly string[];
}

/**
 * Resolves the current actor, or null when signed out.
 *
 * Wrapped in `cache()` so that a page rendering twenty components performs one
 * session lookup and one permission query per request, not twenty.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const handle = session?.sessionHandle;
  if (!handle) return null;

  const resolved = await resolveSession(handle);
  if (!resolved) return null;

  const userRoles = await prisma.userRole.findMany({
    where: { userId: resolved.userId },
    select: {
      role: {
        select: {
          key: true,
          isAssignable: true,
          rolePermissions: { select: { permissionKey: true } },
        },
      },
    },
  });

  const permissions = new Set<PermissionKey>();
  const roleKeys: string[] = [];

  for (const { role } of userRoles) {
    // A role that has been made non-assignable (e.g. retired) grants nothing,
    // even if a stale user_role row still points at it.
    if (!role.isAssignable) continue;
    roleKeys.push(role.key);
    for (const { permissionKey } of role.rolePermissions) {
      permissions.add(permissionKey as PermissionKey);
    }
  }

  return {
    userId: resolved.userId,
    libraryId: resolved.libraryId,
    kind: resolved.kind,
    displayName: resolved.displayName,
    mustSetPassword: resolved.mustSetPassword,
    permissions,
    roleKeys,
  };
});

/** Throws unless someone is signed in. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new NotAuthenticatedError();
  return actor;
}

/** Non-throwing permission test, for deciding what to render. */
export function can(actor: Actor | null, permission: PermissionKey): boolean {
  return actor?.permissions.has(permission) ?? false;
}

/**
 * The gate every service entry point calls first. Throws before any work is
 * done, so an unauthorized call cannot have side effects.
 */
export async function requirePermission(permission: PermissionKey): Promise<Actor> {
  const actor = await requireActor();
  if (!actor.permissions.has(permission)) {
    throw new NotAuthorizedError(
      `User ${actor.userId} lacks permission ${permission}`,
    );
  }
  return actor;
}

export async function requireAnyPermission(
  permissions: readonly PermissionKey[],
): Promise<Actor> {
  const actor = await requireActor();
  if (!permissions.some((p) => actor.permissions.has(p))) {
    throw new NotAuthorizedError(
      `User ${actor.userId} lacks all of: ${permissions.join(", ")}`,
    );
  }
  return actor;
}

/**
 * Guards access to one member's own records.
 *
 * A member may only ever reach their own row. Staff need an explicit permission.
 * The failure is NotFound rather than NotAuthorized on purpose: a child probing
 * ids must not be able to learn which ones exist.
 */
export async function requireMemberAccess(memberUserId: string): Promise<Actor> {
  const actor = await requireActor();

  if (actor.kind === "MEMBER") {
    if (actor.userId !== memberUserId) {
      throw new NotFoundError(
        `Member ${actor.userId} attempted to read member ${memberUserId}`,
      );
    }
    return actor;
  }

  if (!actor.permissions.has("member.view")) {
    throw new NotFoundError(`User ${actor.userId} may not read member ${memberUserId}`);
  }
  return actor;
}

/**
 * Guards tenant boundaries. Every repository read is already scoped by
 * libraryId; this is the assertion for anything that takes an id directly.
 */
export function assertSameLibrary(actor: Actor, libraryId: string): void {
  if (actor.libraryId !== libraryId) {
    throw new NotFoundError(
      `User ${actor.userId} (library ${actor.libraryId}) attempted to reach library ${libraryId}`,
    );
  }
}
