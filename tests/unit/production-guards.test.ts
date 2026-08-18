import { describe, expect, it } from "vitest";

import {
  CaptureEmailProvider,
  RefusingEmailProvider,
  ResendEmailProvider,
  SmtpEmailProvider,
  selectEmailProvider,
} from "@/server/lib/email/providers";
import { BlobStorageDriver, LocalStorageDriver, selectStorageDriver } from "@/server/lib/storage";
import { UPLOAD_RULES } from "@/server/lib/uploads";

/**
 * Two pieces of configuration that used to fail quietly in production.
 *
 * Both were found by reading the deployment path rather than the feature code,
 * and both had the same shape: a development default that keeps working when
 * it should stop. A library that appears to be running while nothing reaches a
 * family, and while a child's photograph goes to a disk that evaporates, is
 * worse than one that plainly refuses.
 */

describe("the email transport in production", () => {
  it("captures to disk on a laptop, so nothing can reach a real family", () => {
    expect(selectEmailProvider("console", false)).toBeInstanceOf(CaptureEmailProvider);
  });

  it("refuses to pretend in production, where the capture directory is nobody's inbox", () => {
    expect(selectEmailProvider("console", true)).toBeInstanceOf(RefusingEmailProvider);
  });

  it("records the refusal as a failure with a reason, rather than throwing at the librarian", async () => {
    const result = await new RefusingEmailProvider().send();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("EMAIL_PROVIDER=console");
  });

  it("leaves a configured transport alone in either environment", () => {
    expect(selectEmailProvider("resend", true)).toBeInstanceOf(ResendEmailProvider);
    expect(selectEmailProvider("smtp", true)).toBeInstanceOf(SmtpEmailProvider);
    expect(selectEmailProvider("resend", false)).toBeInstanceOf(ResendEmailProvider);
  });
});

describe("object storage in production", () => {
  it("uses the local disk in development, outside public/", () => {
    expect(selectStorageDriver(false, undefined)).toBeInstanceOf(LocalStorageDriver);
  });

  it("refuses to start without a Blob store rather than write a photograph to a container", () => {
    expect(() => selectStorageDriver(true, undefined)).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it("never silently falls back to the local driver in production", () => {
    let driver: unknown = null;
    try {
      driver = selectStorageDriver(true, undefined);
    } catch {
      // expected
    }
    expect(driver).not.toBeInstanceOf(LocalStorageDriver);
  });

  it("uses the Blob store when one is linked", () => {
    expect(selectStorageDriver(true, "vercel_blob_rw_example").name).toBe("vercel-blob");
  });
});

/**
 * A Vercel Blob store's access mode is fixed when the store is created, and a
 * private object needs a private store. One store therefore has to be private,
 * which means nothing this application uploads may ask to be public. These
 * tests exist so that adding a "public" upload purpose fails here rather than
 * in production, where the fix would be a second store and a second credential.
 */
describe("one private Blob store is enough", () => {
  it("stores every upload purpose privately, the logo included", () => {
    const publicPurposes = Object.entries(UPLOAD_RULES)
      .filter(([, rules]) => rules.visibility === "PUBLIC")
      .map(([purpose]) => purpose);

    expect(publicPurposes).toEqual([]);
  });

  it("refuses a public object rather than storing it privately and lying about the URL", async () => {
    await expect(
      new BlobStorageDriver().put("k", new Uint8Array([1]), "image/png", "PUBLIC"),
    ).rejects.toThrow(/private/i);
  });
});
