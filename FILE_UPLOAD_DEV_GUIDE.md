# File Upload Infrastructure — Developer Guide

*Living document for the attachment / file-upload feature. Branch
`claude/file-upload-infrastructure-28r4m5`.*

This guide is the source of truth for how file uploads work. It supersedes the
original MinIO-specific plan in `CLAUDE_HANDOVER.md §3.5` (see **Storage backend
decision** below for why we diverged).

---

## 1. What this delivers

- A driver-agnostic object-storage layer (`StorageAdapter`) with a local-disk
  implementation. MinIO / S3 can be added later as a drop-in adapter.
- An `Attachment` model that polymorphically attaches files to a `TASK`,
  `FINDING`, `TEMPLATE`, or `WP`, with compliance soft-delete.
- REST endpoints under `/api/attachments` for upload, list, download, delete,
  and policy lookup.
- Admin-configurable size / type limits stored in `SystemSetting`
  (`FILE_UPLOAD_CONFIG`) — never hardcoded (NON-NEGOTIABLE RULE 10).
- A reusable `FileUploadField` React component, wired into the dynamic Task form
  (`file_upload` field type) and the Finding detail **Evidence** section.

---

## 2. Storage backend decision (diverges from §3.5)

`§3.5` of the handover locked MinIO. We use a **local-disk driver behind a
pluggable adapter** instead, because:

1. **Downloads are proxied through the backend** (`GET /:id/download` streams the
   bytes). MinIO's headline features — the S3 API and presigned URLs — are
   therefore never used, so running a separate MinIO daemon (~150–300 MB RAM)
   buys nothing on the VPS.
2. **Storage is never exposed publicly** — the bytes only ever leave through an
   authenticated backend route, not a public/presigned URL that can't be revoked
   mid-window. This is a real advantage over presigned URLs.
3. **The adapter interface keeps the §3.5 intent**: switching to MinIO / S3 / R2
   later is a one-file change (implement `MinioAdapter`, set
   `STORAGE_DRIVER=minio`), not a rewrite.

> **Authorization scope — read honestly.** `list` and `download` currently
> require only **authentication**, not per-entity authorization. This matches the
> app's deliberate *transparency model* (findings are globally readable —
> `buildFindingScope` returns `{}` — and tasks/WPs are viewable system-wide), so
> attachments being readable by any authenticated user is consistent with how
> their parent records already behave. It is **not** a per-download RBAC check. If
> visibility is ever tightened, add the scope check in **one** place —
> `assertEntityExists` in `attachmentService.ts` is the natural seam — so download
> doesn't become the read path that bypasses scoping. **Delete** is authorized:
> the uploader, or a holder of the `attachment:delete_any` privilege.

The §3.5 bucket *names* are preserved as logical roots (`sqd-tasks`,
`sqd-findings`, `sqd-templates`) so the migration path stays clean.

---

## 3. Backend layout

| File | Responsibility |
|---|---|
| `src/constants/fileUpload.ts` | Policy types, default config (mirrors §3.5), entity→bucket map, validators, `ABSOLUTE_MAX_UPLOAD_BYTES`. |
| `src/config/storage.ts` | Validated env: `STORAGE_DRIVER`, `STORAGE_LOCAL_ROOT` (fail-fast). |
| `src/services/storage/StorageAdapter.ts` | The `StorageAdapter` interface + `ObjectNotFoundError`. |
| `src/services/storage/LocalDiskAdapter.ts` | Filesystem implementation (path-traversal guarded). |
| `src/services/storage/index.ts` | `getStorage()` factory (cached) + `initStorage()`. |
| `src/services/attachmentService.ts` | Config load, validation, atomic create + dual-write, privilege-gated soft-delete. |
| `src/controllers/attachment.controller.ts` | HTTP handlers; never leaks `storageKey`; `toPublic()` projector + temp-file cleanup. |
| `src/routes/attachment.routes.ts` | Multer (**disk** temp storage, single file) + route wiring. |

### Storage key format

`<entityType>/<entityId>/<uuid>-<sanitized-filename>` within the entity's bucket.
Filenames are sanitized (path components stripped, unsafe chars replaced, length
capped) before they ever touch disk.

---

## 4. Upload flow & invariants

1. **Multer** streams one `file` part to a **temp file on disk** (`diskStorage`,
   `os.tmpdir()`) — NOT buffered in memory, so concurrent large uploads don't pin
   RAM on the VPS. Bounded by `ABSOLUTE_MAX_UPLOAD_BYTES` (100 MB) — a fixed
   memory/disk-safety ceiling, **not** the business limit. `LIMIT_FILE_SIZE` →
   `413`. The controller `unlink`s the temp file in a `finally` on every path.
2. **`createAttachmentService`** then enforces the *policy* (Admin-configurable):
   - MIME type must match a category in `FILE_UPLOAD_CONFIG` → else `415`.
     (Type is the client-declared `mimetype`; combined with forced
     `Content-Disposition: attachment` on download it is not an XSS vector, but
     it is not content-sniffed — treat the allow-list as advisory, not a
     security boundary.)
   - File size ≤ that category's `maxSizeBytes` → else `413`.
   - Owning entity must exist (soft-delete filtered) → else `404`.
   - Sum of existing (non-deleted) attachment sizes + this file ≤
     `totalPerEntityBytes` → else `413`.
3. **The temp file is moved into storage first** (`putFile` → `rename`, with an
   `EXDEV` copy fallback), then the row + audit + feed post are written in a
   single `prisma.$transaction`. If the DB write fails, the stored object is
   removed (orphan-file is the safe failure direction; a committed row always
   has its bytes). The total-quota check is **not** row-locked — a tiny
   over-limit is possible under a concurrent race, and the existence check is not
   transactional with the create (acceptable for an internal tool; documented
   here).

### Dual write (RULE 3)

Every upload **and** soft-delete writes:
- An `AuditLog` row (`ATTACHMENT_UPLOADED` / `ATTACHMENT_DELETED`) — always.
- A `SYSTEM_EVENT` `FeedPost` on the entity's feed — for `TASK` / `WP` / `FINDING`
  (`TEMPLATE` has no feed, so audit-only).

### Soft delete (RULE 2)

`DELETE /:id` sets `Attachment.deletedAt`. **The stored object is intentionally
NOT removed** — evidence files are an aviation compliance record. Soft-deleted
rows are filtered from list/download. Allowed for the original uploader, or any
actor holding the **`attachment:delete_any`** privilege — a DB-driven key in the
Phase-7 `PRIVILEGE_CATALOG` (default: Director / Admin / Manager), resolved via
`hasPrivilege`, **not** a hardcoded role array. An Admin can now reconfigure who
may delete others' evidence from the Privilege Management panel.

---

## 5. API reference

All routes require auth (cookie JWT). Base: `/api/attachments`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/config` | Active upload policy (`{ categories, totalPerEntityBytes }`). |
| `GET` | `/?entityType=&entityId=&fieldId=` | List non-deleted attachments. `storageKey` never returned. |
| `POST` | `/` | Multipart: `file` + `entityType`, `entityId`, optional `fieldId`. → `201` metadata. |
| `GET` | `/:id/download` | Streams bytes through the backend (private storage). |
| `DELETE` | `/:id` | Soft-delete (uploader or elevated role). |

---

## 6. Frontend

- `src/api/attachmentApi.ts` — `getUploadConfig`, `listAttachments`,
  `uploadAttachment` (FormData + progress), `downloadAttachment` (blob → browser
  save), `deleteAttachment`.
- `src/components/ui/FileUploadField.tsx` — self-contained: loads the existing
  file set + policy on mount, uploads sequentially (so the per-entity quota is
  checked file-by-file), download/delete per row, surfaces failures as toasts.
  `getUploadConfig()` is cached at module scope, so a form with N file fields
  fetches the policy once. Calls `onChange(attachmentIds)` **only after an
  upload/delete** — never on the initial read — so merely viewing a task does not
  dirty the form or clobber saved `TaskData`.
- **Task form**: `TaskFormPanel` threads `taskId` into the `file_upload` field
  renderer; attachment ids are stored in `TaskData` for that field. The field is
  read-only in the same statuses as the rest of the form.
- **Finding evidence**: the Finding detail page renders a `FileUploadField`
  (`entityType="FINDING"`), disabled once the finding is `Closed`/`Dismissed`.

---

## 7. Configuration

### Env (backend `.env`)

```
STORAGE_DRIVER=local                       # 'local' (default) | 'minio' (not yet wired)
STORAGE_LOCAL_ROOT=/app/backend/storage    # persistent path; git-ignored
```

`deploy.sh` writes these, creates the storage dir, and sets nginx
`client_max_body_size 100M` so large uploads reach the backend.

### Policy (Admin-configurable, RULE 10)

Stored in `SystemSetting` key `FILE_UPLOAD_CONFIG` as JSON, seeded from
`DEFAULT_FILE_UPLOAD_CONFIG`:

```json
{
  "categories": [
    { "label": "Documents", "mimeTypes": ["application/pdf", "...docx", "...xlsx", "text/plain"], "maxSizeBytes": 20971520 },
    { "label": "Images",    "mimeTypes": ["image/jpeg", "image/png", "image/webp"], "maxSizeBytes": 10485760 }
  ],
  "totalPerEntityBytes": 52428800
}
```

`loadFileUploadConfig()` reads this row per request and falls back to the default
if it is missing/invalid.

**Known limitations (call out before relying on Rule 10):**
- **No write endpoint yet.** The row is seeded (`update: {}`, so a re-seed never
  clobbers a customised value) but there is no `PUT /api/settings/file-upload`.
  Until one is added, "Admin-configurable" means a direct DB upsert of
  `SystemSetting['FILE_UPLOAD_CONFIG']`. A settings-panel endpoint is the next
  step to fully satisfy Rule 10.
- **Hard ceiling.** A category `maxSizeBytes` is clamped to
  `ABSOLUTE_MAX_UPLOAD_BYTES` (100 MB) by `parseFileUploadConfig`, and nginx caps
  the body at `100M`. An Admin cannot raise a per-file limit above the ceiling
  without also raising both the constant and the nginx config (a redeploy). The
  config endpoint returns the **clamped** value, so the UI never advertises a
  limit the server would reject.

---

## 8. Tests

`src/__tests__/attachment.test.ts` (13 tests) — storage runs against a temp dir
(`STORAGE_LOCAL_ROOT=/tmp/sqd-test-storage` in `.env.test`); no object store is
mocked because the local driver works in CI. Covers: auth, happy-path upload +
dual-write + `storageKey` hiding, missing-file/invalid-type/invalid-entity,
policy size + per-entity-total limits, list (excludes deleted), download bytes +
content-type, soft-delete RBAC (uploader vs other-staff vs manager), and the
config endpoint. The suite fully cleans up its tasks/templates/users in
`afterAll` so it never leaks into other suites.

Full suite: **444 passing** (431 baseline + 13).

---

## 9. To add a MinIO / S3 adapter later

1. `npm i minio` (or an S3 SDK).
2. Implement `MinioAdapter implements StorageAdapter` (`ensureReady` = create
   buckets; `put`/`getStream`/`remove` against the bucket API).
3. Register it in `services/storage/index.ts` under `case 'minio'`.
4. Add the MinIO env vars to `config/storage.ts` (endpoint/keys/SSL).
5. Set `STORAGE_DRIVER=minio`. No controller/service/frontend change needed.
