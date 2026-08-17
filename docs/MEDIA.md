# Child Photographs and Stored Media

A photograph of a child is the most sensitive thing this system will ever hold.
Everything below follows from that.

---

## 1. Three rules

1. **Nothing is served without an authorization decision.** There is no public
   URL, no CDN path, no signed URL, no static file. Every read goes through
   `/api/media/[id]`, which decides for *this viewer* on *this request*.
2. **The database row is the ledger; the bytes follow it.** A transaction and an
   object-store write cannot be made atomic, so no code path pretends otherwise.
3. **A photograph is never the expected choice.** Avatars are equal citizens and
   the default. A family declining to upload one gets an account that looks
   exactly as complete and exactly as cheerful as everybody else's.

## 2. The three options on `/join`

| | What the parent does | What is stored |
|---|---|---|
| **A** | Uploads a photograph | A private `media_object`, plus a `CHILD_PHOTO_STORAGE` consent record |
| **B** | Picks an avatar | An avatar key. No file, nothing to leak |
| **C** | Neither | An avatar key — the default one |

Neither a photo nor an avatar choice is mandatory. `getAvatar()` falls back to a
default for a null key, so there is no such thing as a card with no picture.

The photo consent tickbox appears **only once a photo has actually been chosen**.
Asking every family to agree to storing a photograph they never uploaded is
noise, and noise is how consent forms stop being read. It is a separate consent
type precisely so a family can withdraw the photo without withdrawing the
membership.

The file travels with the form submission. There is no upload endpoint a parent's
browser talks to, so closing the tab halfway leaves nothing anywhere.

## 3. Who may see a child's photograph

Decided in `getAuthorizedMedia()`:

- **The child themselves.** They chose the picture and it is of them. Hiding it
  from its own subject would be strange to a nine-year-old and protects nobody.
  It appears on their own card and nowhere else.
- **Staff holding `member.view`** — the desk needs to recognise the reader in
  front of them.
- **Staff holding `registration.view`**, for a photo still attached to a pending
  request, because that is the screen where the decision gets made.

Nobody else. Not another child, not a signed-out visitor, not the catalogue.

**Every refusal is `404`, never `403`.** A child walking ids must not be able to
tell a photograph that exists and belongs to someone else from one that was never
uploaded — a 403 answers "yes, that id is real". Verified in the browser: an
unknown id and another child's id return byte-identical responses.

### Response headers

| Header | Value | Why |
|---|---|---|
| `Cache-Control` | `private, no-store, max-age=0, must-revalidate` | Never a shared cache; off the disk of a shared family device after sign-out |
| `X-Content-Type-Options` | `nosniff` | Stops a browser second-guessing the type we validated |
| `Content-Security-Policy` | `default-src 'none'; sandbox; base-uri 'none'` | Even if a non-image reached storage, it is served with no privileges |
| `Content-Disposition` | `inline` | It is a picture, not a download |

⚠️ `src/proxy.ts` **excludes `api/media` from its matcher**. The proxy sets the
*page* CSP on everything it touches, which silently overwrote the far stricter
policy above — the bytes were being served under the application's script policy.
Caught by probing the live response, not by reading the code. If the matcher is
ever edited, re-check this.

## 4. The lifecycle: how nothing is orphaned

`media_object.pending_deletion_at` is the whole mechanism. Every object is either
**claimed** or **scheduled**, never merely forgotten.

```
upload   →  row created with pending_deletion_at = now + 15 min   ("unclaimed")
claim    →  pending_deletion_at = NULL, in the SAME transaction as the link
remove   →  pending_deletion_at = now(), in the SAME transaction as the unlink
purge    →  delete bytes, THEN delete row
```

**Why the bytes are written before the row exists:** a storage failure then
leaves no row at all. The alternative — a row whose bytes were never written —
is a state every later read has to defend against.

**Why the row is deleted last:** a failure halfway leaves a row still pointing at
possibly-deleted bytes, which is visible, retryable, and already refused by
`getAuthorizedMedia` because it is pending deletion. Row-first would leave bytes
nothing knows about, which is the state this design exists to prevent.

`purgeScheduledMedia` refuses to touch anything not already scheduled. That guard
is what makes a mistaken call harmless.

### Replacement is transactional from the application's point of view

The profile points at the new object and the old one is scheduled for deletion in
a **single commit**. Either both happened or neither did. Only the object-store
cleanup is eventual, and it can only ever run *late* — never early, and never on
an object something still points at.

If the transaction fails, the new object is simply never claimed: it keeps the
deadline it was born with and the sweeper collects it. There is no compensating
cleanup path to get wrong.

### The sweeper

`sweepPendingMedia()` runs in the daily cron. It collects:

- uploads nobody ever claimed (abandoned forms)
- objects whose immediate purge failed

It is a **safety net, not the primary path** — removal and replacement delete the
bytes inline. After `MAX_DELETE_ATTEMPTS` (5) an object is reported in
`needsAttention` rather than retried forever in silence.

A day when the cron does not run leaves a private photograph in storage slightly
longer. That is why it is daily and not weekly.

### Where a rejected registration's photo goes

Rejection schedules it for deletion in the same transaction and purges
immediately. A closed request has no reason to keep a private photograph of a
child.

A duplicate submission is swallowed silently (so the form cannot answer "is this
child already registered?"), and the photo uploaded a moment earlier is purged
straight away rather than left for the nightly sweep.

## 5. Upload validation

Unchanged from Phase 0 and still the gate everything passes through:

- **Magic bytes decide the type.** The filename is ignored; the declared
  `Content-Type` is ignored. An ELF binary named `sweet-child.jpg` is rejected on
  its bytes.
- **Executable signatures are refused** — ELF, Mach-O, PE, Java class, shell
  script, zip.
- **SVG is refused** for anything a parent can upload. It can carry script.
- **5 MB cap**, with a message a parent can act on rather than "validation
  failed".
- **The storage key is generated by us**: `child_photo/<year>/<month>/<random>.png`.
  The user's filename never enters a path — that is how directory traversal and
  double-extension tricks get in. Two identical uploads get different keys.

### Metadata is stripped before storage

A photograph taken on a phone routinely carries EXIF: the camera, the exact
timestamp, and very often **GPS coordinates**. For a picture of a child that
usually means the coordinates of their home. None of it is needed to run a
library, and the cheapest way to protect it is not to store it.

`stripImageMetadata()` removes it:

| Format | Removed |
|---|---|
| JPEG | every `APPn` segment (EXIF, XMP, ICC, maker notes) and every comment |
| PNG | `tEXt`, `iTXt`, `zTXt`, `eXIf` and any other non-rendering chunk |
| WebP | the `EXIF` and `XMP ` chunks, with the RIFF length repaired |

This is **byte surgery on the container, not re-encoding** — deliberately.
Re-encoding needs a native image library, degrades the picture, and turns a
malicious file into a decoder attack surface. Walking the container is
dependency-free, lossless for the actual pixels, and cannot fail open: anything
it does not understand was already refused by `validateUpload`. A file with
nothing to strip comes back byte-identical.

`byteSize` and `checksumSha256` describe the **stored** bytes, not the upload —
recording the original's size would misdescribe the object in storage.

⚠️ `validateUpload` returns `bytes`. **Store those, never the caller's array**,
which still carries everything that was just stripped.

**Not** done: no re-encoding, no resizing, no thumbnails. A 5 MB photograph stays
5 MB.

### The claim guard

The obvious attack on a public registration endpoint is to post a registration
carrying *somebody else's* media id. `claimUnclaimedChildPhoto` accepts an id
only if it is in this library, private, actually a child photograph, and **still
unclaimed** — and does it as a single conditional `UPDATE`, so exactly one caller
can ever claim a given object.

## 6. Storage drivers

| | Local (development) | Vercel Blob (production) |
|---|---|---|
| Location | `.storage/`, **outside `public/`** | Blob store, `access: private` |
| Public URL | Never for private objects | Never for private objects |

A database CHECK forbids a `PRIVATE` object from carrying a `public_url`, so this
holds even if a driver misbehaves.

⚠️ `.storage` is a **relative** path, resolved against the process working
directory — normally the project root, but not if something starts `next dev`
from elsewhere. Worth knowing when hunting for a development upload: the bytes
follow the process, not the repository.

## 7. Permissions

`member.manage_photo` — replace or remove a child's photograph. Held by Librarian
and Super Admin. Explicitly in `PERMISSIONS_FORBIDDEN_FOR_CHILD_STAFF`, so the
Junior Librarian role can never hold it: a child volunteer at the desk must not
be handling another child's photograph.

Removal asks for a reason, like every other action that changes a child's record.
It goes to the audit log, never to the family. Every touch is logged —
`member.photo.added`, `.replaced`, `.removed` — recording the object's **id** and
never its key, its bytes, or anything derived from them.

## 8. Verified in the browser

Walked live against the running application on 17 August 2026:

- `/join` offers photo, avatar and neither; photo consent appears only with a photo
- A submission with no photo succeeds
- A submission with a photo stores it `PRIVATE`, `public_url` NULL, opaque key,
  outside `public/`
- The librarian's queue renders it through `/api/media/[id]` → `200 image/png`,
  `private, no-store`, `nosniff`, `default-src 'none'; sandbox`
- Signed out → `404`
- Signed in as a different child → `404`, byte-identical to an id that never existed
- Approval carries the photo onto the library card
- **Replace** → profile points at the new object; old row gone, old bytes gone;
  exactly one file on disk; audit records both ids
- **Remove** → profile cleared, avatar restored, zero rows, zero bytes, audited
  with the reason and the actor
