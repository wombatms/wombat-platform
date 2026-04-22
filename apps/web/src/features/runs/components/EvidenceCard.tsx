/**
 * EvidenceCard — displays a single evidence record in the gallery grid.
 *
 * Design direction: industrial/forensic. Cards are tight slabs with a
 * coloured left-border strip whose hue derives from the parent result
 * status token (not colour-only — the left border shape + status chip
 * icon carry the non-colour cue per spec §5 accessibility rule).
 *
 * Image cards desaturate at rest (filter: grayscale(30%)) and snap to
 * full-colour on hover using CSS transitions — a structural affordance
 * that draws the eye to the hovered item without animation overhead.
 *
 * Non-image cards show a monogram slab (first two chars of the
 * extension) on a muted panel — no generic icon library dependency for
 * this treatment.
 *
 * SP3.3 Task 47.
 */

import { useState, useCallback } from "react";
import { useEvidenceUrl } from "../hooks/evidence";
import type { EvidenceRecord, EvidenceActorRef } from "../hooks/evidence";
import type { ResultStatus } from "../hooks/results";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceCardProps {
  record: EvidenceRecord;
  /** Result status of the parent result row — drives the left-border colour. */
  resultStatus: ResultStatus;
  onClick: (record: EvidenceRecord) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IMAGE_MIME_PREFIXES = ["image/"];

/** Resolve the MIME type from a record (handles both field-name variants). */
export function getMimeType(record: EvidenceRecord): string {
  return record.mime_type ?? record.content_type ?? "application/octet-stream";
}

function isImage(contentType: string): boolean {
  return IMAGE_MIME_PREFIXES.some((p) => contentType.startsWith(p));
}

/** Format bytes as a human-readable string: "1.2 MB", "340 KB", "512 B". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${Math.round(bytes / 1_024)} KB`;
  return `${bytes} B`;
}

/** Extract the file extension (without dot), uppercased. Max 4 chars. */
function fileExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "BIN";
  return filename.slice(dot + 1).toUpperCase().slice(0, 4);
}

// ---------------------------------------------------------------------------
// Status accent helpers
// ---------------------------------------------------------------------------

const STATUS_BORDER: Record<ResultStatus, string> = {
  pass: "var(--result-pass-fg)",
  fail: "var(--result-fail-fg)",
  blocked: "var(--result-blocked-fg)",
  skipped: "var(--result-skipped-fg)",
};

const STATUS_SHAPE: Record<ResultStatus, React.ReactNode> = {
  pass: (
    <svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden="true">
      <path d="M1 3.5L2.8 5.2L6 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  fail: (
    <svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden="true">
      <path d="M1.5 1.5L5.5 5.5M5.5 1.5L1.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  blocked: (
    <svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden="true">
      <path d="M1.5 3.5H5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  skipped: (
    <svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden="true">
      <path d="M2 2L5 3.5L2 5V2Z" fill="currentColor" />
      <path d="M5.5 2V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Image thumbnail subcomponent
// ---------------------------------------------------------------------------

interface ImageThumbProps {
  evidenceId: string;
  filename: string;
}

function ImageThumb({ evidenceId, filename }: ImageThumbProps) {
  const { data: urlData, isLoading, isError } = useEvidenceUrl(evidenceId);
  const [imgError, setImgError] = useState(false);

  if (isLoading) {
    return (
      <div
        className="w-full h-full animate-pulse"
        style={{ background: "var(--bg-surface-3)" }}
        aria-label="Loading thumbnail"
      />
    );
  }

  if (isError || imgError || !urlData?.url) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ background: "var(--bg-surface-2)" }}
        aria-label="Thumbnail unavailable"
      >
        <span
          className="font-mono text-[10px] font-bold tracking-widest uppercase"
          style={{ color: "var(--fg-disabled)" }}
        >
          {fileExt(filename)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={urlData.url}
      alt={filename}
      onError={() => setImgError(true)}
      className="w-full h-full object-cover transition-all duration-200"
      style={{
        filter: "grayscale(30%) brightness(0.97)",
      }}
      // Inline style override on hover is handled by the parent card's
      // CSS hover state via a CSS custom property approach below.
    />
  );
}

// ---------------------------------------------------------------------------
// File-type monogram slab (non-image)
// ---------------------------------------------------------------------------

interface FileMonogramProps {
  filename: string;
  contentType: string;
}

function FileMonogram({ filename, contentType }: FileMonogramProps) {
  const ext = fileExt(filename);
  // Derive a subtle tint from the content type category for visual differentiation.
  const tintVar = contentType.startsWith("text/")
    ? "var(--accent-soft)"
    : contentType.startsWith("application/pdf")
      ? "#fdf4de"
      : contentType.startsWith("video/")
        ? "#dceaf6"
        : "var(--bg-surface-3)";

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1"
      style={{ background: tintVar }}
      aria-hidden="true"
    >
      <span
        className="font-mono text-xs font-black tracking-[0.15em] leading-none"
        style={{ color: "var(--fg-muted)" }}
      >
        {ext}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status chip (compact, inline)
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: ResultStatus }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-[9px] font-semibold uppercase tracking-wider leading-none h-4"
      style={{
        color: `var(--result-${status}-fg)`,
        background: `var(--result-${status}-bg)`,
      }}
      aria-label={`Result: ${label}`}
    >
      <span style={{ color: `var(--result-${status}-fg)` }}>
        {STATUS_SHAPE[status]}
      </span>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Uploaded-by label
// ---------------------------------------------------------------------------

function UploadedByLabel({ uploadedBy }: { uploadedBy: EvidenceActorRef | null | undefined }) {
  if (!uploadedBy) {
    return <span style={{ color: "var(--fg-disabled)" }} className="text-[9px]">unknown</span>;
  }
  const kind = uploadedBy.principal_type === "token" ? "token" : "user";
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: "var(--fg-muted)" }}
    >
      {kind === "token" ? (
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 4.5H6M4.5 3V6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
          <circle cx="4.5" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 8C1.5 6.067 2.91 4.5 4.5 4.5C6.09 4.5 7.5 6.067 7.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
      <span className="font-mono text-[9px] truncate max-w-[80px]">
        {uploadedBy.id.slice(0, 8)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// EvidenceCard
// ---------------------------------------------------------------------------

export function EvidenceCard({
  record,
  resultStatus,
  onClick,
  className,
}: EvidenceCardProps) {
  const mimeType = getMimeType(record);
  const img = isImage(mimeType);
  const borderColor = STATUS_BORDER[resultStatus];

  const handleClick = useCallback(() => {
    onClick(record);
  }, [onClick, record]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(record);
      }
    },
    [onClick, record],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Evidence: ${record.filename}, ${formatBytes(record.size_bytes)}, result ${resultStatus}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex flex-col rounded-md overflow-hidden cursor-pointer",
        "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        "transition-shadow duration-150",
        className,
      )}
      style={{
        background: "var(--bg-surface-1)",
        border: "1px solid var(--border-default)",
        borderLeft: `3px solid ${borderColor}`,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Thumbnail / monogram area */}
      <div
        className="relative overflow-hidden"
        style={{
          height: "120px",
          background: "var(--bg-surface-2)",
        }}
      >
        <div
          className="w-full h-full transition-all duration-200 group-hover:scale-[1.02] group-focus-visible:scale-[1.02]"
          style={{ transformOrigin: "center" }}
        >
          {img ? (
            <div
              className="w-full h-full"
              style={{
                // CSS custom property trick: hover filter reset is handled here
                // via a simple class toggle in the parent group
              }}
            >
              <style>{`
                .ev-card-img img {
                  filter: grayscale(30%) brightness(0.97);
                  transition: filter 200ms ease;
                }
                .ev-card-img:hover img,
                .ev-card-img:focus-within img {
                  filter: grayscale(0%) brightness(1);
                }
              `}</style>
              <div className="ev-card-img w-full h-full">
                <ImageThumb evidenceId={record.id} filename={record.filename} />
              </div>
            </div>
          ) : (
            <FileMonogram filename={record.filename} contentType={mimeType} />
          )}
        </div>
      </div>

      {/* Metadata footer */}
      <div
        className="flex flex-col gap-1.5 px-2.5 pt-2 pb-2.5"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        {/* Filename */}
        <p
          className="text-[11px] font-semibold font-mono leading-tight truncate"
          style={{ color: "var(--fg-default)" }}
          title={record.filename}
        >
          {record.filename}
        </p>

        {/* Size + status chip row */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[9px] font-mono tabular-nums"
            style={{ color: "var(--fg-muted)" }}
          >
            {formatBytes(record.size_bytes)}
          </span>
          <StatusChip status={resultStatus} />
        </div>

        {/* Uploaded by */}
        <UploadedByLabel uploadedBy={record.uploaded_by} />
      </div>
    </div>
  );
}
