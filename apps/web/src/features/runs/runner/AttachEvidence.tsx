/**
 * AttachEvidence — file-attach sub-form for the Runner action bar.
 *
 * Features:
 * - Click-to-select or drag-and-drop file target
 * - Client-side 25 MB cap with inline error (EvidenceTooLargeError)
 * - XHR upload progress bar (0–1) via useUploadEvidence from Task 40
 * - Success state shows filename + dismiss
 * - Multiple files in sequence — each upload completes before enabling next
 *
 * Design tone: industrial/utilitarian. Drag zone uses a dashed border with
 * a drop-shadow highlight on drag-over. Progress bar is a thin filled track.
 */

import { useRef, useState, useCallback, useId } from "react";
import { Paperclip, Upload, CheckCircle, AlertCircle, X } from "lucide-react";
import { useUploadEvidence, MAX_EVIDENCE_BYTES } from "../hooks/evidence";
import { EvidenceTooLargeError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

const MAX_MB = MAX_EVIDENCE_BYTES / (1024 * 1024); // 25

interface AttachEvidenceProps {
  projectSlug: string;
  runId: string;
  caseId: string;
  disabled?: boolean;
}

type UploadState =
  | { phase: "idle" }
  | { phase: "dragging" }
  | { phase: "uploading"; filename: string; progress: number }
  | { phase: "done"; filename: string }
  | { phase: "error"; message: string };

export function AttachEvidence({
  projectSlug,
  runId,
  caseId,
  disabled = false,
}: AttachEvidenceProps) {
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const dropZoneId = useId();

  const uploadMutation = useUploadEvidence(projectSlug, runId, caseId);

  const handleFile = useCallback(
    async (file: File) => {
      // Client-side size check
      if (file.size > MAX_EVIDENCE_BYTES) {
        setUploadState({
          phase: "error",
          message: `File exceeds ${MAX_MB} MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        return;
      }

      setUploadState({
        phase: "uploading",
        filename: file.name,
        progress: 0,
      });

      try {
        await uploadMutation.mutateAsync({
          file,
          onProgress: (p) => {
            setUploadState({ phase: "uploading", filename: file.name, progress: p });
          },
        });
        setUploadState({ phase: "done", filename: file.name });
        // Auto-clear success message after 4 s
        setTimeout(() => {
          setUploadState((prev) =>
            prev.phase === "done" ? { phase: "idle" } : prev,
          );
        }, 4000);
      } catch (err) {
        const msg =
          err instanceof EvidenceTooLargeError
            ? `File too large — max ${MAX_MB} MB.`
            : err instanceof Error
              ? err.message
              : "Upload failed.";
        setUploadState({ phase: "error", message: msg });
      }
    },
    [uploadMutation],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleFile(file);
      }
      // Reset so the same file can be re-selected after an error
      e.target.value = "";
    },
    [handleFile],
  );

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setUploadState((prev) =>
      prev.phase === "idle" || prev.phase === "dragging"
        ? { phase: "dragging" }
        : prev,
    );
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear dragging if we left the drop zone entirely
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setUploadState((prev) =>
        prev.phase === "dragging" ? { phase: "idle" } : prev,
      );
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setUploadState({ phase: "idle" });
      const file = e.dataTransfer.files[0];
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  const isUploading = uploadState.phase === "uploading";
  const isDragging = uploadState.phase === "dragging";

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Label */}
      <div className="flex items-center justify-between">
        <label
          htmlFor={dropZoneId}
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          Attach evidence
        </label>
        <span
          className="text-[10px]"
          style={{ color: "var(--fg-disabled)" }}
        >
          Max {MAX_MB} MB
        </span>
      </div>

      {/* Drop zone */}
      {(uploadState.phase === "idle" || uploadState.phase === "dragging") && !isUploading && (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label="Upload evidence file — click or drag and drop"
          aria-controls={dropZoneId}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!disabled) inputRef.current?.click();
            }
          }}
          className={cn(
            "flex items-center gap-3 rounded-lg px-4 py-3 cursor-pointer",
            "border-2 border-dashed transition-all duration-100",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-1",
            disabled && "opacity-40 cursor-not-allowed",
          )}
          style={{
            background: isDragging
              ? "color-mix(in srgb, var(--accent-primary) 8%, var(--bg-surface-2))"
              : "var(--bg-surface-2)",
            borderColor: isDragging
              ? "var(--accent-primary)"
              : "var(--border-default)",
            boxShadow: isDragging
              ? "0 0 0 3px color-mix(in srgb, var(--accent-primary) 15%, transparent)"
              : "none",
          }}
        >
          {isDragging ? (
            <Upload
              className="h-4 w-4 shrink-0 animate-bounce"
              style={{ color: "var(--accent-primary)" }}
              aria-hidden="true"
            />
          ) : (
            <Paperclip
              className="h-4 w-4 shrink-0"
              style={{ color: "var(--fg-muted)" }}
              aria-hidden="true"
            />
          )}
          <span
            className="text-[12px]"
            style={{ color: isDragging ? "var(--accent-primary)" : "var(--fg-muted)" }}
          >
            {isDragging ? "Drop to attach" : "Click or drag a file to attach"}
          </span>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        id={dropZoneId}
        type="file"
        className="sr-only"
        onChange={handleInputChange}
        disabled={disabled || isUploading}
        aria-label="Upload evidence file"
        accept="image/*,video/*,application/pdf,.txt,.log"
      />

      {/* Uploading state */}
      {isUploading && uploadState.phase === "uploading" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span
              className="truncate max-w-[200px] font-mono"
              style={{ color: "var(--fg-muted)" }}
              title={uploadState.filename}
            >
              {uploadState.filename}
            </span>
            <span
              className="tabular-nums shrink-0 ml-2"
              style={{ color: "var(--fg-muted)" }}
            >
              {Math.round(uploadState.progress * 100)}%
            </span>
          </div>
          {/* Progress track */}
          <div
            className="h-1 rounded-full overflow-hidden"
            style={{ background: "var(--bg-surface-3)" }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(uploadState.progress * 100)}
            aria-label={`Upload progress: ${Math.round(uploadState.progress * 100)}%`}
          >
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{
                width: `${uploadState.progress * 100}%`,
                background: "var(--accent-primary)",
              }}
            />
          </div>
        </div>
      )}

      {/* Done state */}
      {uploadState.phase === "done" && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{
            background: "var(--feedback-success-bg)",
            border: "1px solid color-mix(in srgb, var(--feedback-success-fg) 25%, transparent)",
          }}
        >
          <CheckCircle
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--feedback-success-fg)" }}
            aria-hidden="true"
          />
          <span
            className="text-[12px] flex-1 min-w-0 truncate font-mono"
            style={{ color: "var(--feedback-success-fg)" }}
            title={uploadState.filename}
          >
            {uploadState.filename}
          </span>
          <button
            type="button"
            onClick={() => setUploadState({ phase: "idle" })}
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100 transition-opacity"
          >
            <X className="h-3.5 w-3.5" style={{ color: "var(--feedback-success-fg)" }} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Error state */}
      {uploadState.phase === "error" && (
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2"
          style={{
            background: "var(--feedback-error-bg)",
            border: "1px solid color-mix(in srgb, var(--feedback-error-fg) 25%, transparent)",
          }}
          role="alert"
        >
          <AlertCircle
            className="h-3.5 w-3.5 shrink-0 mt-0.5"
            style={{ color: "var(--feedback-error-fg)" }}
            aria-hidden="true"
          />
          <span
            className="text-[12px] flex-1 leading-snug"
            style={{ color: "var(--feedback-error-fg)" }}
          >
            {uploadState.message}
          </span>
          <button
            type="button"
            onClick={() => setUploadState({ phase: "idle" })}
            aria-label="Dismiss error"
            className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
          >
            <X className="h-3.5 w-3.5" style={{ color: "var(--feedback-error-fg)" }} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
