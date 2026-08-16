import { PrismaClient } from "@prisma/client";

import { seedDemo } from "./demo";
import { seedLibrary } from "./library";
import { seedPlatform } from "./platform";

/**
 * Seed entry point.
 *
 *   npm run db:seed          platform + library configuration (safe anywhere)
 *   npm run db:seed:demo     the above, plus fake people and books (dev only)
 *
 * The split matters: production needs the permission catalogue and the library
 * configuration, and must never receive a fake child.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const withDemo = process.argv.includes("--demo");

  try {
    console.log("\nSeeding platform data…");
    await seedPlatform(prisma);

    console.log("\nSeeding library configuration…");
    const { libraryId } = await seedLibrary(prisma);

    if (withDemo) {
      await seedDemo(prisma, libraryId);
    }

    console.log("\nDone.\n");

    if (!withDemo) {
      console.log(
        "No administrator account was created. Create one securely with:\n  npm run create-admin\n",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nSeed failed:\n", error);
  process.exit(1);
});
