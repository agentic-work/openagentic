/**
 * BinaryRef + BinaryStore — types-only contract for the Flows binary data plane.
 *
 * SCOPE
 * ─────
 * This file is TYPES ONLY — no implementation yet. It pins the interface
 * shape the future binary data plane will land against, so node executors
 * (csv_processor binary mode, xlsx_processor, document_loader, file_upload
 * passthrough) can be written against a stable signature while the storage
 * layer is being built out separately.
 *
 * WHY THIS PATTERN
 * ────────────────
 * Inspired by n8n's BinaryRef pattern: a workflow item carries a typed
 * reference to binary content (not the bytes themselves) alongside its JSON
 * payload. Nodes resolve / write through a single store interface so the
 * concrete backend (MinIO via api proxy, local fs, in-memory for tests)
 * can swap without rewriting executors.
 *
 * SHAPE DECISIONS
 * ───────────────
 * - BinaryRef is OPAQUE outside the store. Callers carry it through their
 *   `data.binary` field and never inspect the `id`/`backend` slots.
 * - The store interface is intentionally minimal — `put`, `get`,
 *   `delete`, `exists`. Streaming variants come later when xlsx hits the
 *   size ceiling for in-memory base64.
 * - `mimeType` and `sizeBytes` are required so consumers can route
 *   without dereferencing the bytes (e.g. csv_processor refuses anything
 *   that doesn't match `text/csv` or `application/vnd.ms-excel`).
 * - `sha256` is required so the store can dedupe + so audit trails can
 *   prove content integrity end-to-end.
 *
 * CONSUMERS (PLANNED, NOT WIRED)
 * ──────────────────────────────
 * - csv_processor (binary mode — currently text-only, shipped 2026-05-14)
 * - xlsx_processor (currently blocked on binary plane)
 * - document_loader (PDF/DOCX → text chunks for RAG — blocked on binary plane)
 * - file_upload (workflow input attachments — currently base64 in JSON)
 * - http_request (response body when content-type is binary — currently
 *   stringified to JSON, lossy for non-UTF-8)
 *
 * STORAGE LAYER (DEFERRED)
 * ────────────────────────
 * The concrete `BinaryStore` impls will be:
 *
 *   1. `MinioApiProxyBinaryStore` — POST/GET against
 *      openagentic-api's existing `BlobStorageService` (which already
 *      abstracts MinIO/GCS/Azure/S3). The engine never holds direct minio
 *      credentials; it goes through the api with internal-auth, same
 *      pattern as data_source_query / create_subflow.
 *
 *   2. `LocalFsBinaryStore` — dev / single-node deployments without a
 *      blob store. Writes to a configurable base path.
 *
 *   3. `InMemoryBinaryStore` — harness tests. Resets between cases.
 *
 * The selection is via env `BINARY_STORE` (default `'api-proxy'`).
 *
 * CHANGELOG
 * ─────────
 * - 2026-05-15: types-only landing as Tier 2 #5 scoping deliverable.
 *   No consumer wires this yet; arch test pins the interface so future
 *   PRs that flesh out the store + executors land against a stable shape.
 */

/**
 * Opaque reference to a binary payload. Carries enough metadata for
 * downstream nodes to route on type/size without dereferencing the bytes.
 */
export interface BinaryRef {
  /** Backend-assigned identifier. Treat as opaque outside the store. */
  readonly id: string;
  /** Backend that owns this ref (api-proxy | local-fs | in-memory). */
  readonly backend: BinaryBackend;
  /** Canonical MIME type at write time. */
  readonly mimeType: string;
  /** Original filename when known (uploads, http_request response). */
  readonly filename?: string;
  /** Size of the persisted payload in bytes. */
  readonly sizeBytes: number;
  /** SHA-256 of the persisted bytes, hex-encoded lowercase. */
  readonly sha256: string;
  /** Persistence timestamp (epoch ms). */
  readonly createdAt: number;
  /**
   * Optional MIME-specific metadata. Examples:
   *   - text/csv  : { delimiter: ',', encoding: 'utf-8', columns: number }
   *   - application/pdf : { pages: number, encrypted: boolean }
   *   - image/png : { width, height }
   * Schema is owned by the producing node; consumers fall back gracefully.
   */
  readonly meta?: Record<string, unknown>;
}

export type BinaryBackend = 'api-proxy' | 'local-fs' | 'in-memory';

/**
 * Minimum surface every BinaryStore impl exposes. Streaming variants
 * (`putStream` / `getStream`) come in a follow-up when xlsx/document_loader
 * hits the in-memory ceiling.
 */
export interface BinaryStore {
  /**
   * Persist bytes; returns a BinaryRef the caller stores on the workflow
   * item's `data.binary` field.
   */
  put(input: BinaryPutInput): Promise<BinaryRef>;

  /**
   * Fetch the persisted bytes for a ref. Returns null when the ref is
   * unknown (consumer decides whether that's an error or a soft-miss).
   */
  get(ref: BinaryRef): Promise<Buffer | null>;

  /**
   * Cheap existence check without materializing the bytes — useful for
   * cleanup loops and recovery paths.
   */
  exists(ref: BinaryRef): Promise<boolean>;

  /**
   * Hard delete. Implementations may no-op when the backend has its own
   * TTL / lifecycle rules.
   */
  delete(ref: BinaryRef): Promise<void>;
}

export interface BinaryPutInput {
  /** Raw bytes. Streaming variant lives on the future `putStream`. */
  data: Buffer;
  /** Canonical MIME type. */
  mimeType: string;
  /** Original filename when relevant. */
  filename?: string;
  /** MIME-specific metadata to carry on the ref. */
  meta?: Record<string, unknown>;
}
