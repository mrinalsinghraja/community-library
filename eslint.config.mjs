import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Lint rules that enforce the architecture, not just the formatting.
 *
 * Two of these are load-bearing:
 *
 *   1. The layering rule. Components and actions may not import Prisma. If
 *      business rules can be written in a page, they will be — in five places,
 *      three of which will forget the permission check.
 *
 *   2. The branding rule. "Mana Jardin" and "MJCL" may appear only in
 *      prisma/seed/. This is what keeps the platform genuinely reusable instead
 *      of nominally reusable.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),

  // -------------------------------------------------------------------------
  // Layering: only the server layer may reach the database.
  // -------------------------------------------------------------------------
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "src/server/actions/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              message:
                "Components, pages and actions must not touch the database directly. Call a service in src/server/services or a helper in src/server/lib.",
            },
            {
              name: "@/server/db",
              message:
                "Components, pages and actions must not touch the database directly. Call a service in src/server/services or a helper in src/server/lib.",
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // The platform must stay generic: no community-specific literals in src/.
  // -------------------------------------------------------------------------
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/Mana\\s*Jardin|MJCL/i]",
          message:
            "Community-specific values belong in prisma/seed/library-config.ts and are read at runtime from library_settings. See docs/ARCHITECTURE.md.",
        },
        {
          selector: "TemplateElement[value.raw=/Mana\\s*Jardin|MJCL/i]",
          message:
            "Community-specific values belong in prisma/seed/library-config.ts and are read at runtime from library_settings.",
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Seeds and scripts are Node programs, not application code.
  // -------------------------------------------------------------------------
  {
    files: ["prisma/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
