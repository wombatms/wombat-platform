/**
 * Evidence query + mutation hooks.
 *
 * - useEvidenceUrl    — fetch a short-lived presigned URL for an evidence record;
 *                       staleTime 4.5 min so refetch fires before the 5-min expiry.
 * - useUploadEvidence — multipart upload with progress (0–1) via XMLHttpRequest
 *                       so the Runner can show a progress indicator. Client-side
 *                       rejects files > MAX_EVIDENCE_BYTES with EvidenceTooLargeError.
 * - useDeleteEvidence — hard-delete a single evidence record.
 *
 * Error discipline: all mutations throw specialised ApiError subclasses via
 * mapRunError. Never surfaces raw Response objects.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/storage";
import { runKeys } from "../queryKeys";
import {
  mapRunError,
  EvidenceTooLargeError,
  ApiError,
} from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 25 MB — matches the server-side cap. */
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

/**
 * Presigned URL cache lifetime (ms). We set staleTime to 4.5 min so a
 * background refetch fires before the 5-min server expiry.
 */
const EVIDENCE_URL_STALE_MS = 4.5 * 60 * 1000; // 270_000 ms

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Actor reference on an evidence record. */
export interface EvidenceActorRef {
  /** "user" or "token" */
  principal_type: string;
  /** UUID string of the user or API token. */
  id: string;
}

/**
 * Evidence record as stored / returned by the API.
 *
 * Fields from the upload response (post-upload, in runner context):
 *   id, filename, content_type (alias for mime_type), size_bytes,
 *   caption, created_at, run_id, case_id, result_id.
 *
 * Fields added in Task 47 GET list endpoint:
 *   mime_type (canonical), uploaded_by, uploaded_at.
 *
 * `content_type` is kept as an alias of `mime_type` so that both the
 * legacy upload response shape and the new list shape work without a
 * migration on call sites.  When `mime_type` is present it is preferred;
 * `content_type` falls back.
 */
export interface EvidenceRecord {
  id: string;
  run_id?: string;
  case_id?: string;
  result_id?: string;
  filename: string;
  /** MIME type from the list endpoint (canonical field name from EvidenceOut). */
  mime_type?: string;
  /** MIME type from the upload response (legacy field name). */
  content_type?: string;
  size_bytes: number;
  caption?: string | null;
  created_at?: string;
  /** Populated by the GET list endpoint. */
  uploaded_by?: EvidenceActorRef | null;
  /** ISO timestamp from the GET list endpoint. */
  uploaded_at?: string;
}

export interface EvidenceUrlResponse {
  url: string;
  expires_at: string;
}

export interface UploadEvidenceArgs {
  file: File;
  caption?: string;
  onProgress?: (progress: number) => void;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * List all evidence records attached to a specific case result.
 *
 * Returns an empty array when no result has been recorded yet (the server
 * returns `{ data: [] }` in that case rather than 404).
 *
 * staleTime 30 s — evidence lists are relatively stable; a 0 s staleTime
 * would cause excessive refetches when the gallery mounts on each tab switch.
 */
export function useResultEvidence(
  projectSlug: string,
  runId: string,
  caseId: string,
) {
  return useQuery({
    queryKey: runKeys.evidence(projectSlug, runId, caseId),
    queryFn: async (): Promise<EvidenceRecord[]> => {
      // The schema.d.ts snapshot predates this GET endpoint so we bypass
      // the type constraint with a cast — same pattern as useRunCases.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (api.GET as any)(
        "/api/projects/{project_slug}/runs/{run_id}/results/{case_id}/evidence",
        {
          params: {
            path: {
              project_slug: projectSlug,
              run_id: runId,
              case_id: caseId,
            },
          },
        },
      );
      if (error) throw error;
      const response = data as { data: EvidenceRecord[] };
      return response.data ?? [];
    },
    enabled: Boolean(projectSlug && runId && caseId),
    staleTime: 30_000,
  });
}

/**
 * Fetch a presigned download URL for an evidence record.
 *
 * staleTime is set to 4.5 minutes — the server issues 5-minute presigned
 * URLs, so we keep the cached URL fresh enough for immediate use while still
 * triggering a background refetch before it expires.
 */
export function useEvidenceUrl(evidenceId: string) {
  return useQuery({
    queryKey: ["evidence", evidenceId, "url"],
    queryFn: async (): Promise<EvidenceUrlResponse> => {
      const { data, error } = await api.GET("/api/evidence/{evidence_id}/url", {
        params: { path: { evidence_id: evidenceId } },
      });
      if (error) throw error;
      return data as EvidenceUrlResponse;
    },
    enabled: Boolean(evidenceId),
    staleTime: EVIDENCE_URL_STALE_MS,
    // Do not refetch on window focus for presigned URLs — the staleTime already
    // ensures timely renewal; an extra focus-triggered refetch would waste quota.
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Upload a file as evidence for a specific case result.
 *
 * - Validates client-side that the file does not exceed MAX_EVIDENCE_BYTES;
 *   throws EvidenceTooLargeError immediately so the UI can show an error
 *   without a network round-trip.
 * - Uses XMLHttpRequest (not fetch) for upload-progress events. The
 *   `onProgress` callback receives values in [0, 1].
 * - On success: invalidates the evidence key subtree for the run + result.
 * - On 413 / evidence_too_large from the server: mapRunError throws
 *   EvidenceTooLargeError.
 */
export function useUploadEvidence(
  projectSlug: string,
  runId: string,
  caseId: string,
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: UploadEvidenceArgs): Promise<EvidenceRecord> => {
      const { file, caption, onProgress } = args;

      // Client-side size check — surface immediately, before any network I/O.
      if (file.size > MAX_EVIDENCE_BYTES) {
        throw new EvidenceTooLargeError(
          new ApiError(413, {
            code: "evidence_too_large",
            message: `File size ${file.size} bytes exceeds the 25 MB limit.`,
            field: "file",
            hint: null,
          }),
        );
      }

      const accessToken = getAccessToken();
      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
      const url = `${baseUrl}/api/projects/${encodeURIComponent(projectSlug)}/runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(caseId)}/evidence`;

      const formData = new FormData();
      formData.append("file", file);
      if (caption != null) {
        formData.append("caption", caption);
      }

      return new Promise<EvidenceRecord>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);

        if (accessToken) {
          xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        }

        if (onProgress) {
          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              onProgress(event.loaded / event.total);
            }
          });
        }

        xhr.addEventListener("load", () => {
          if (xhr.status === 201) {
            try {
              const body = JSON.parse(xhr.responseText) as unknown;
              resolve((body as { data: EvidenceRecord }).data ?? (body as EvidenceRecord));
            } catch {
              reject(
                new ApiError(xhr.status, {
                  code: "parse_error",
                  message: "Could not parse upload response.",
                  field: null,
                  hint: null,
                }),
              );
            }
          } else {
            // Try to parse the Wombat error envelope; fall back to generic.
            try {
              const body = JSON.parse(xhr.responseText) as Record<string, unknown>;
              const env = (body?.error ?? body) as {
                code?: string;
                message?: string;
                field?: string | null;
                hint?: string | null;
              };
              const apiErr = new ApiError(xhr.status, {
                code: typeof env.code === "string" ? env.code : `http_${xhr.status}`,
                message:
                  typeof env.message === "string" ? env.message : xhr.statusText,
                field: typeof env.field === "string" ? env.field : null,
                hint: typeof env.hint === "string" ? env.hint : null,
              });
              try {
                mapRunError(apiErr);
              } catch (mapped) {
                reject(mapped);
              }
            } catch {
              reject(
                new ApiError(xhr.status, {
                  code: `http_${xhr.status}`,
                  message: xhr.statusText || "Upload failed",
                  field: null,
                  hint: null,
                }),
              );
            }
          }
        });

        xhr.addEventListener("error", () => {
          reject(
            new ApiError(0, {
              code: "network_error",
              message: "Network error during evidence upload.",
              field: null,
              hint: null,
            }),
          );
        });

        xhr.send(formData);
      });
    },

    onSuccess: () => {
      // Invalidate the evidence subtree. caseId is the closure parameter
      // bound when useUploadEvidence(projectSlug, runId, caseId) was called.
      void qc.invalidateQueries({
        queryKey: runKeys.evidence(projectSlug, runId, caseId),
      });
    },
  });
}

/**
 * Delete an evidence record by ID.
 * On success: invalidates the evidence subtree for the run/case.
 */
export function useDeleteEvidence(
  projectSlug: string,
  runId: string,
  caseId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (evidenceId: string): Promise<void> => {
      try {
        const { error } = await api.DELETE(
          "/api/projects/{project_slug}/runs/{run_id}/results/{case_id}/evidence/{evidence_id}",
          {
            params: {
              path: {
                project_slug: projectSlug,
                run_id: runId,
                case_id: caseId,
                evidence_id: evidenceId,
              },
            },
          },
        );
        if (error) throw error;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: runKeys.evidence(projectSlug, runId, caseId),
      });
    },
  });
}
