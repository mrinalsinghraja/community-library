import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { PrismaClient } from "@prisma/client";
import { hash as argon2Hash, type Algorithm } from "@node-rs/argon2";

import { ROLE_KEYS } from "../src/lib/permissions";

/**
 * Creates the first Super Admin securely.
 *
 *   npm run create-admin
 *
 * There is no default password anywhere in this repository, and no bootstrap
 * account is created by the production seed. The password is typed here, never
 * echoed, never logged, never written to a file, and never transmitted — the
 * only thing that reaches the database is an argon2id hash.
 *
 * Run it locally against the production connection string (`vercel env pull`),
 * or from any machine that can reach the database.
 */

// Argon2id. Written as a literal because the library's enum is an ambient
// `const enum`, which isolatedModules forbids referencing.
const ARGON2ID: Algorithm = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const MIN_PASSWORD_LENGTH = 12;

/** Reads a line without echoing it to the terminal. */
async function readSecret(prompt: string): Promise<string> {
  stdout.write(prompt);

  const wasRaw = stdin.isTTY ? stdin.isRaw : false;
  if (stdin.isTTY) stdin.setRawMode(true);

  return new Promise<string>((resolve) => {
    let value = "";

    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf8");

      switch (char) {
        case "\n":
        case "\r":
        case "\u0004": // Ctrl-D
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.removeListener("data", onData);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          break;

        case "\u0003": // Ctrl-C
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdout.write("\n");
          process.exit(130);
          break;

        case "\u007f": // Backspace
        case "\b":
          value = value.slice(0, -1);
          break;

        default:
          // Printable characters only; arrow keys and other escapes are ignored.
          if (char >= " " && char !== "\u007f") value += char;
      }
    };

    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const library = await prisma.library.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });

    if (!library) {
      console.error(
        "\nNo library exists yet. Run `npm run db:seed` first so there is a library to administer.\n",
      );
      process.exit(1);
    }

    const superAdminRole = await prisma.role.findUnique({
      where: { libraryId_key: { libraryId: library.id, key: ROLE_KEYS.SUPER_ADMIN } },
      select: { id: true },
    });

    if (!superAdminRole) {
      console.error("\nThe SUPER_ADMIN role is missing. Run `npm run db:seed` first.\n");
      process.exit(1);
    }

    console.log(`\nCreating a Super Admin for: ${library.name}\n`);

    const displayName = (await rl.question("Full name: ")).trim();
    const email = (await rl.question("Email address: ")).trim().toLowerCase();

    if (!displayName || !email.includes("@")) {
      console.error("\nA name and a valid email address are both required.\n");
      process.exit(1);
    }

    const existing = await prisma.appUser.findFirst({
      where: { libraryId: library.id, email },
      select: { id: true },
    });

    if (existing) {
      console.error(`\nAn account already exists for ${email}.\n`);
      process.exit(1);
    }

    // Close the readline interface before taking over stdin for raw input.
    rl.close();

    const password = await readSecret(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);
    const confirmation = await readSecret("Confirm password: ");

    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(`\nPassword must be at least ${MIN_PASSWORD_LENGTH} characters.\n`);
      process.exit(1);
    }
    if (password !== confirmation) {
      console.error("\nThose passwords did not match.\n");
      process.exit(1);
    }

    const passwordHash = await argon2Hash(password, ARGON2_OPTIONS);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.appUser.create({
        data: {
          libraryId: library.id,
          kind: "STAFF",
          displayName,
          email,
          passwordHash,
          status: "ACTIVE",
          mustSetPassword: false,
        },
      });

      await tx.userRole.create({
        data: { userId: created.id, roleId: superAdminRole.id },
      });

      await tx.auditLog.create({
        data: {
          libraryId: library.id,
          action: "user.created",
          entityType: "app_user",
          entityId: created.id,
          actorUserId: created.id,
          actorLabel: displayName,
          // No password material of any kind goes into the audit metadata.
          metadata: { via: "create-admin CLI", role: ROLE_KEYS.SUPER_ADMIN },
        },
      });

      return created;
    });

    console.log(`\n✓ Super Admin created: ${user.email}`);
    console.log("  Sign in at /login with that email address and the password you just chose.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFailed to create administrator:\n", error);
  process.exit(1);
});
