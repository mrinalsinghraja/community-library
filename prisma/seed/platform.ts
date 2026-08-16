import { PrismaClient } from "@prisma/client";

import { PERMISSIONS } from "../../src/lib/permissions";

/**
 * Platform seed — runs in EVERY environment, including production.
 *
 * Contains only the permission catalogue: facts about what the software can do,
 * not data about any particular community. Idempotent, so it is safe to re-run
 * on every deploy as new permissions are introduced.
 */
export async function seedPlatform(prisma: PrismaClient): Promise<void> {
  const entries = Object.entries(PERMISSIONS);

  for (const [key, meta] of entries) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, category: meta.category, description: meta.description },
      update: { category: meta.category, description: meta.description },
    });
  }

  console.log(`  ✓ ${entries.length} permissions`);
}
