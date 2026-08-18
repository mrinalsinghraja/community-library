import "server-only";

import { z } from "zod";

/**
 * Server-side environment. Parsed once, at first import, so a misconfigured
 * deployment fails loudly at boot rather than mysteriously at 9am on a Saturday.
 *
 * Nothing here is ever sent to the browser. Values the client legitimately needs
 * live in NEXT_PUBLIC_* and are read directly where required.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Database -------------------------------------------------------------
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Unpooled connection. Prisma migrations must not run through a pooler. */
  DIRECT_URL: z.string().min(1).optional(),

  // --- Auth -----------------------------------------------------------------
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters — generate with `openssl rand -base64 32`"),
  AUTH_URL: z.url().optional(),
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // --- Application ----------------------------------------------------------
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  /**
   * Bootstrap timezone only. Once a library row exists,
   * library_settings.timezone is authoritative and this is ignored.
   */
  APP_TIMEZONE: z.string().default("Asia/Kolkata"),

  // --- Email (Phase 5; declared here so deployments can be configured early) --
  EMAIL_PROVIDER: z.enum(["resend", "smtp", "console"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),

  // --- Storage --------------------------------------------------------------
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // --- Jobs -----------------------------------------------------------------
  CRON_SECRET: z.string().optional(),

  // --- Password hardening ---------------------------------------------------
  /**
   * Opt in to checking new passwords against the Have I Been Pwned corpus via
   * k-anonymity (only a 5-character hash prefix leaves this server). Off by
   * default: it is an outbound request from a child-facing form, and that is a
   * community's decision to make. Always fails open.
   */
  PASSWORD_BREACH_CHECK: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // There is deliberately no bootstrap token here. An earlier plan had a
  // one-time /setup route guarded by SETUP_TOKEN; it was never built, and the
  // variable outlived it. `npm run create-admin` needs no HTTP route at all,
  // which is one fewer public path that can create an administrator.
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    // Never print the values themselves — only which keys are wrong.
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  // Cross-field rules the shape alone cannot express.
  if (env.NODE_ENV === "production") {
    if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
      throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
    }
    if (env.EMAIL_PROVIDER === "smtp" && !(env.SMTP_HOST && env.SMTP_PORT)) {
      throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST and SMTP_PORT");
    }
    if (env.EMAIL_PROVIDER !== "console" && !env.EMAIL_FROM) {
      throw new Error("EMAIL_FROM is required when email is enabled");
    }
  }

  return env;
}

export const env: ServerEnv = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
