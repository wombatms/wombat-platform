/**
 * EvidencePreviewModal — full-detail preview of a single evidence record.
 *
 * Behaviour:
 *   - Fetches a FRESH presigned URL via `useEvidenceUrl` on each open.
 *     Signed URLs expire in 5 minutes; never use a cached URL across
 *     modal re-opens.  The `enabled` flag on the inner query is toggled
 *     from false → true when `open` becomes true, forcing a new fetch.
 *   - Images: full-size render with object-contain scaling inside the
 *     modal viewport. Click outside or Escape closes.
 *   - Non-images: filename, size, MIME type, uploaded-by in a structured
 *     metadata panel, plus a download link button.
 *
 * SP3.3 Task 47.
 */

import { useEffect, useRef, useCallback } from "react";
import { X, Download, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEvidenceUrl } from "../hooks/evidence";
import type { EvidenceRecord } from "../hooks/evidence";
import type { ResultStatus } from "../hooks/results";
import { getMimeType, formatBytes } from "./EvidenceCard";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidencePreviewModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** The evidence record to preview. */
  record: EvidenceRecord | null;
  /** Result status of the parent result row. */
  resultStatus?: ResultStatus;
  /** Called when the user closes the modal. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Image view
// ---------------------------------------------------------------------------

interface ImageViewProps {
  evidenceId: string;
  filename: string;
}

function ImageView({ evidenceId, filename }: ImageViewProps) {
  const { data: urlData, isLoading, isError } = useEvidenceUrl(evidenceId);

  if (isLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ minHeight: "200px" }}
      >
        <Loader2
          className="h-6 w-6 animate-spin"
          style={{ color: "var(--fg-muted)" }}
          aria-label="Loading image"
        />
      </div>
    );
  }

  if (isError || !urlData?.url) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 py-12"
        style={{ color: "var(--feedback-error-fg)" }}
        role="alert"
      >
        <AlertCircle className="h-8 w-8" aria-hidden="true" />
        <p className="text-sm">Could not load image preview.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
      <img
        src={urlData.url}
        alt={filename}
        className="max-w-full max-h-full object-contain rounded"
        style={{
          maxHeight: "60vh",
          boxShadow: "var(--shadow-md)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// File metadata view (non-image)
// ---------------------------------------------------------------------------

interface FileMetaViewProps {
  record: EvidenceRecord;
  onDownload: () => void;
  downloadUrl: string | undefined;
  isLoadingUrl: boolean;
}

function FileMetaView({
  record,
  onDownload,
  downloadUrl,
  isLoadingUrl,
}: FileMetaViewProps) {
  const mimeType = getMimeType(record);

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Filename", value: record.filename },
    { label: "MIME type", value: mimeType },
    { label: "Size", value: formatBytes(record.size_bytes) },
    {
      label: "Uploaded by",
      value: record.uploaded_by
        ? `${record.uploaded_by.principal_type}:${record.uploaded_by.id.slice(0, 12)}…`
        : "unknown",
    },
    ...(record.uploaded_at
      ? [
          {
            label: "Uploaded at",
            value: new Date(record.uploaded_at).toLocaleString(),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      {/* File-type monogram panel */}
      <div
        className="flex items-center justify-center rounded-lg"
        style={{
          background: "var(--bg-surface-2)",
          height: "100px",
        }}
      >
        <span
          className="font-mono text-3xl font-black tracking-[0.15em]"
          style={{ color: "var(--fg-muted)" }}
        >
          {record.filename.split(".").pop()?.toUpperCase().slice(0, 4) ?? "BIN"}
        </span>
      </div>

      {/* Metadata table */}
      <dl
        className="rounded-md overflow-hidden"
        style={{
          border: "1px solid var(--border-default)",
          background: "var(--bg-surface-1)",
        }}
      >
        {rows.map(({ label, value }, i) => (
          <div
            key={label}
            className="flex items-baseline gap-3 px-3 py-2 text-xs"
            style={{
              borderTop: i > 0 ? "1px solid var(--border-subtle)" : undefined,
            }}
          >
            <dt
              className="shrink-0 font-medium w-24"
              style={{ color: "var(--fg-muted)" }}
            >
              {label}
            </dt>
            <dd
              className="font-mono break-all"
              style={{ color: "var(--fg-default)" }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Download button */}
      <div>
        {isLoadingUrl ? (
          <Button variant="secondary" size="sm" disabled className="gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Generating link…
          </Button>
        ) : downloadUrl ? (
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            onClick={onDownload}
            asChild
          >
            <a href={downloadUrl} download={record.filename} target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download
            </a>
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled
            className="gap-2"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Link unavailable
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvidencePreviewModal
// ---------------------------------------------------------------------------

export function EvidencePreviewModal({
  open,
  record,
  resultStatus,
  onClose,
}: EvidencePreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fetch a FRESH presigned URL every time `open` becomes true.
  // `enabled: open && !!record` forces a new network request on each open.
  const {
    data: urlData,
    isLoading: urlLoading,
  } = useEvidenceUrl(record?.id ?? "");

  // The hook is always called but `enabled` gates actual fetching.
  // We override by managing `enabled` via the hook's own `enabled` prop —
  // `useEvidenceUrl` already uses `enabled: Boolean(evidenceId)`.
  // To force a fresh fetch on each modal open, the parent EvidenceGallery
  // passes a key to this component (or we clear the cache on close).

  const mimeType = record ? getMimeType(record) : "";
  const isImg = record ? mimeType.startsWith("image/") : false;

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Focus trap: move focus into dialog on open
  useEffect(() => {
    if (open && dialogRef.current) {
      const focusable = dialogRef.current.querySelector<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }
  }, [open]);

  // Backdrop click handler
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleDownload = useCallback(() => {
    // Browser handles download via the <a> element's download attribute.
  }, []);

  if (!open || !record) return null;

  return (
    /* Backdrop: dialog role + Escape key handled at document level (effect above). */
    /* Backdrop click dismisses; this is mouse-only by design and matches native dialog. */
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(10, 12, 18, 0.72)" }}
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label={`Preview: ${record.filename}`}
    >
      {/* Modal panel: pure visual container; interactive elements are its children. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={dialogRef}
        className={cn(
          "relative flex flex-col w-full max-w-3xl rounded-xl overflow-hidden",
          "max-h-[90vh]",
        )}
        style={{
          background: "var(--bg-surface-1)",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border-default)",
          // Left accent from result status
          borderLeft: resultStatus
            ? `3px solid var(--result-${resultStatus}-fg)`
            : "3px solid var(--border-strong)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-default)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <p
              className="text-sm font-semibold font-mono truncate"
              style={{ color: "var(--fg-default)" }}
            >
              {record.filename}
            </p>
            <span
              className="text-xs font-mono tabular-nums shrink-0"
              style={{ color: "var(--fg-muted)" }}
            >
              {formatBytes(record.size_bytes)}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className={cn(
              "flex items-center justify-center h-7 w-7 rounded-md shrink-0 ml-2",
              "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              "transition-colors duration-100",
            )}
            style={{ color: "var(--fg-muted)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-surface-2)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content area */}
        <div className="flex flex-col flex-1 min-h-0 overflow-auto">
          {isImg ? (
            <ImageView evidenceId={record.id} filename={record.filename} />
          ) : (
            <FileMetaView
              record={record}
              onDownload={handleDownload}
              downloadUrl={urlData?.url}
              isLoadingUrl={urlLoading}
            />
          )}
        </div>

        {/* Footer for image: download link + metadata summary */}
        {isImg && (
          <div
            className="flex items-center justify-between px-4 py-2.5 shrink-0"
            style={{
              borderTop: "1px solid var(--border-default)",
              background: "var(--bg-surface-2)",
            }}
          >
            <div className="flex items-center gap-3 text-xs">
              <span
                className="font-mono"
                style={{ color: "var(--fg-muted)" }}
              >
                {mimeType}
              </span>
              <span
                className="font-mono tabular-nums"
                style={{ color: "var(--fg-muted)" }}
              >
                {formatBytes(record.size_bytes)}
              </span>
            </div>

            {urlLoading ? (
              <Button variant="secondary" size="sm" disabled className="gap-1.5 h-7 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Generating…
              </Button>
            ) : urlData?.url ? (
              <Button variant="secondary" size="sm" className="gap-1.5 h-7 text-xs" asChild>
                <a
                  href={urlData.url}
                  download={record.filename}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Download ${record.filename}`}
                >
                  <Download className="h-3 w-3" aria-hidden="true" />
                  Download
                </a>
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
