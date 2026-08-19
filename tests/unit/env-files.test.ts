import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_ONLY_ENV_FILES,
  SAFE_PULL_FILENAME,
  envFilesFor,
  productionEnvFilesInPlay,
} from "@/lib/env-files";

/**
 * A production build was once run on a laptop that still held a pulled
 * production environment, and Next.js loaded it exactly as documented. These
 * tests are the standing guard against that returning: no local development or
 * test command may select a file whose name only ever means production.
 *
 * No secret values appear here, and none are read.
 */

describe("what a local command reads", () => {
  it("never lets development touch a production env file", () => {
    const files = envFilesFor("development");

    for (const forbidden of PRODUCTION_ONLY_ENV_FILES) {
      expect(files).not.toContain(forbidden);
    }
    expect(files).toEqual([".env.development.local", ".env.local", ".env.development", ".env"]);
  });

  it("never lets the test suite touch a production env file, or a personal override", () => {
    const files = envFilesFor("test");

    for (const forbidden of PRODUCTION_ONLY_ENV_FILES) {
      expect(files).not.toContain(forbidden);
    }
    // `.env.local` is a developer's own override. The test suite must see the
    // same environment on every machine, so it is not read either.
    expect(files).not.toContain(".env.local");
  });

  it("treats an unrecognised NODE_ENV as development rather than production", () => {
    expect(envFilesFor("staging")).toEqual(envFilesFor("development"));
    expect(envFilesFor("")).toEqual(envFilesFor("development"));
  });

  it("documents that production mode does read them — which is the whole problem", () => {
    expect(envFilesFor("production")).toContain(".env.production.local");
  });

  it("gives the pulled-production file a name no mode loads", () => {
    for (const mode of ["development", "test", "production"]) {
      expect(envFilesFor(mode)).not.toContain(SAFE_PULL_FILENAME);
    }
  });
});

describe("the build guard", () => {
  it("refuses a local production build when a pulled production file is present", () => {
    expect(
      productionEnvFilesInPlay({
        nodeEnv: "production",
        onVercel: false,
        present: [".env.production.local"],
      }),
    ).toEqual([".env.production.local"]);
  });

  it("says nothing when the working copy is clean", () => {
    expect(
      productionEnvFilesInPlay({ nodeEnv: "production", onVercel: false, present: [] }),
    ).toEqual([]);
  });

  it("leaves Vercel alone, where these variables are the platform's job", () => {
    expect(
      productionEnvFilesInPlay({
        nodeEnv: "production",
        onVercel: true,
        present: [".env.production.local", ".env.production"],
      }),
    ).toEqual([]);
  });

  it("does not interfere with the development server or the tests", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(
        productionEnvFilesInPlay({
          nodeEnv,
          onVercel: false,
          present: [".env.production.local"],
        }),
      ).toEqual([]);
    }
  });
});

describe("the repository itself", () => {
  it("wires the guard into the build and the start", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.prebuild).toContain("check-env");
    expect(pkg.scripts.prestart).toContain("check-env");
  });

  it("ignores every env file except the committed template", () => {
    const gitignore = readFileSync(".gitignore", "utf8").split("\n").map((line) => line.trim());

    expect(gitignore).toContain(".env*");
    expect(gitignore).toContain("!.env.example");
  });
});
