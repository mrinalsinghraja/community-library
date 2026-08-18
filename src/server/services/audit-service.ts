import "server-only";

import type { Prisma } from "@prisma/client";

import { requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";

/**
 * Reading the audit log.
 *
 * The log has been written since Phase 0 — every mutation, in the same
 * transaction as the change. Until now the only way to read it was SQL. This
 * service is the read side, and it is read-only in the strongest sense: there
 * is no update, no delete and no export in this file, and no service anywhere
 * else touches `audit_log` after a row is written.
 *
 * **What a viewer sees, and what it does not.**
 *
 * The row itself — when, who, what action, which kind of thing — is operational
 * information a Super Admin needs. The `metadata` blob is a different matter: it
 * belongs to whichever service wrote it, and across the application it carries
 * children's names, book titles and refusal reasons. A screen that printed
 * every blob would quietly become a place to read about children, so this
 * service returns metadata for **configuration actions only**, where it is a
 * before/after of the library's own policy numbers and contains no person.
 *
 * That is a narrowing on top of the existing redaction, not a replacement for
 * it: `redactMetadata` still strips anything credential-shaped at write time,
 * and nothing here relaxes it. See ADR-035.
 */

/** Actions whose metadata is policy, not people, and may therefore be shown. */
const METADATA_SAFE_ACTIONS = new Set<string>(["settings.updated", "branding.updated"]);

export const AUDIT_PAGE_SIZE = 25;

export interface AuditEntry {
  id: string;
  occurredAt: Date;
  action: string;
  actorLabel: string;
  entityType: string;
  entityId: string | null;
  /** Null for every action except configuration changes. See above. */
  details: Prisma.JsonValue | null;
}

export interface AuditFilter {
  /** Inclusive, as a yyyy-MM-dd date from the form. */
  from?: string;
  to?: string;
  action?: string;
  /** Matched against the denormalised actor label, case-insensitively. */
  actor?: string;
  entityType?: string;
  page?: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageCount: number;
  /** Every action and entity type actually present, for the filter dropdowns. */
  availableActions: string[];
  availableEntityTypes: string[];
}

function parseDay(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function listAuditEvents(filter: AuditFilter = {}): Promise<AuditPage> {
  const actor = await requirePermission("audit.view");

  const from = parseDay(filter.from, false);
  const to = parseDay(filter.to, true);
  const page = Math.max(1, Math.trunc(filter.page ?? 1));

  const where: Prisma.AuditLogWhereInput = {
    // Always this actor's library. A log is not a place tenancy may be relaxed.
    libraryId: actor.libraryId,
    ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
    ...(filter.actor ? { actorLabel: { contains: filter.actor.trim(), mode: "insensitive" } } : {}),
  };

  const [total, rows, actions, entityTypes] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        occurredAt: true,
        action: true,
        actorLabel: true,
        entityType: true,
        entityId: true,
        metadata: true,
      },
    }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { libraryId: actor.libraryId },
      orderBy: { action: "asc" },
    }),
    prisma.auditLog.groupBy({
      by: ["entityType"],
      where: { libraryId: actor.libraryId },
      orderBy: { entityType: "asc" },
    }),
  ]);

  return {
    entries: rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      action: row.action,
      actorLabel: row.actorLabel,
      entityType: row.entityType,
      entityId: row.entityId,
      details: METADATA_SAFE_ACTIONS.has(row.action) ? (row.metadata ?? null) : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    availableActions: actions.map((row) => row.action),
    availableEntityTypes: entityTypes.map((row) => row.entityType),
  };
}
