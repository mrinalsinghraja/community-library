import type { StorageDriver, StoredObject } from "@/server/lib/storage";

/**
 * An object store that lives in a Map.
 *
 * Tests need to assert that bytes actually disappear when a photo is removed —
 * the whole point of the media lifecycle design — so a driver that records is
 * more useful here than the real filesystem one, and it cannot leave a private
 * child photograph on a developer's disk after a test run.
 */
export class FakeStorageDriver implements StorageDriver {
  readonly name = "fake";
  readonly objects = new Map<string, Uint8Array>();

  /** When set, the next delete fails — for testing the sweeper's retry path. */
  failNextDelete = false;
  /** When set, every put fails. */
  failPut = false;

  async put(
    key: string,
    bytes: Uint8Array,
    _contentType: string,
    visibility: "PUBLIC" | "PRIVATE",
  ): Promise<StoredObject> {
    if (this.failPut) throw new Error("simulated storage failure");
    this.objects.set(key, bytes);
    return { storageKey: key, publicUrl: visibility === "PUBLIC" ? `/fake/${key}` : null };
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("simulated delete failure");
    }
    this.objects.delete(key);
  }

  reset(): void {
    this.objects.clear();
    this.failNextDelete = false;
    this.failPut = false;
  }
}

/** A minimal but genuinely valid PNG: the 8-byte signature and some payload. */
/**
 * A PNG-shaped blob, big enough to pass the book-cover floor by default.
 *
 * The default was 64 bytes, which every cover test used and which
 * `validateUpload` now refuses: a book jacket has a minimum size, on the
 * grounds that under it is nearly always a thumbnail lifted from a search
 * result. Tests that are about something else should not have to know that, so
 * the default clears the floor and a caller can still ask for any size.
 */
export function pngBytes(size = 128 * 1024): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < size; i += 1) bytes[i] = i % 251;
  return bytes;
}

/** An ELF header wearing a .jpg name — the classic disguised upload. */
export function elfBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46], 0);
  return bytes;
}
