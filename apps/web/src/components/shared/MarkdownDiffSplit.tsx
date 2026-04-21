/**
 * MarkdownDiffSplit — side-by-side diff for Markdown content in proposals.
 *
 * Design (from frontend-design skill):
 * - Two equal-width panes: Before (left) and After (right)
 * - Rendered mode: each pane shows sanitized Markdown via MarkdownBody;
 *   changed-line highlights via a lightweight line-diffing pass with diff-match-patch
 * - Raw mode: unified inline diff with +/- prefix coloring
 * - Synchronized scroll between panes
 * - All colors via SP3.1 CSS custom properties
 */

import type { RefObject } from "react";
import { useRef, useCallback, useMemo } from "react";
import { diff_match_patch } from "diff-match-patch";
import { MarkdownBody } from "./MarkdownBody";
import { cn } from "@/lib/utils";

export interface MarkdownDiffSplitProps {
  before: string;
  after: string;
  mode: "rendered" | "raw";
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Line-level diff helpers                                              */
/* ------------------------------------------------------------------ */

type LineOp = "equal" | "insert" | "delete";

interface LineDiff {
  op: LineOp;
  text: string;
}

function computeLineDiffs(before: string, after: string): LineDiff[] {
  const dmp = new diff_match_patch();
  const a = dmp.diff_linesToChars_(before, after);
  const diffs = dmp.diff_main(a.chars1, a.chars2, false);
  dmp.diff_charsToLines_(diffs, a.lineArray);

  const result: LineDiff[] = [];
  for (const [op, text] of diffs) {
    const lines = text.split("\n");
    // Remove trailing empty entry from split
    if (lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      result.push({
        op: op === 1 ? "insert" : op === -1 ? "delete" : "equal",
        text: line,
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Raw diff view                                                        */
/* ------------------------------------------------------------------ */

function RawDiff({ diffs }: { diffs: LineDiff[] }) {
  return (
    <div
      className="overflow-auto rounded-md text-[12px] font-mono leading-relaxed"
      style={{
        background: "var(--code-bg)",
        border: "1px solid var(--border-default)",
        padding: "0.75rem",
        fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace",
      }}
    >
      {diffs.map((d, i) => {
        const color =
          d.op === "insert"
            ? "var(--feedback-success-fg)"
            : d.op === "delete"
              ? "var(--feedback-error-fg)"
              : "var(--fg-muted)";
        const bg =
          d.op === "insert"
            ? "color-mix(in srgb, var(--feedback-success-fg) 8%, transparent)"
            : d.op === "delete"
              ? "color-mix(in srgb, var(--feedback-error-fg) 8%, transparent)"
              : undefined;
        const prefix = d.op === "insert" ? "+" : d.op === "delete" ? "-" : " ";

        return (
          <div
            key={i}
            className="flex items-start min-h-[1.4em]"
            style={{ background: bg }}
          >
            <span
              className="w-4 shrink-0 select-none"
              style={{ color }}
              aria-hidden="true"
            >
              {prefix}
            </span>
            <span style={{ color: color === "var(--fg-muted)" ? "var(--code-fg)" : color }}>
              {d.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rendered side-by-side view                                           */
/* ------------------------------------------------------------------ */

function RenderedPane({
  label,
  content,
  scrollRef,
  onScroll,
  side,
}: {
  label: string;
  content: string;
  scrollRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
  side: "before" | "after";
}) {
  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      <div
        className="shrink-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{
          background: "var(--bg-surface-2)",
          borderBottom: "1px solid var(--border-default)",
          color: side === "before" ? "var(--feedback-error-fg)" : "var(--feedback-success-fg)",
        }}
      >
        {label}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-4"
        onScroll={onScroll}
        style={{ background: "var(--bg-app)" }}
      >
        {content ? (
          <MarkdownBody>{content}</MarkdownBody>
        ) : (
          <p className="text-[12px] italic" style={{ color: "var(--fg-muted)" }}>
            Empty
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MarkdownDiffSplit                                                    */
/* ------------------------------------------------------------------ */

export function MarkdownDiffSplit({
  before,
  after,
  mode,
  className,
}: MarkdownDiffSplitProps) {
  const leftRef = useRef<HTMLDivElement>(null) as RefObject<HTMLDivElement>;
  const rightRef = useRef<HTMLDivElement>(null) as RefObject<HTMLDivElement>;
  const syncing = useRef(false);

  const diffs = useMemo(() => computeLineDiffs(before, after), [before, after]);

  const syncLeft = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (rightRef.current && leftRef.current) {
      const ratio =
        leftRef.current.scrollTop /
        (leftRef.current.scrollHeight - leftRef.current.clientHeight || 1);
      rightRef.current.scrollTop =
        ratio * (rightRef.current.scrollHeight - rightRef.current.clientHeight);
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  const syncRight = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (leftRef.current && rightRef.current) {
      const ratio =
        rightRef.current.scrollTop /
        (rightRef.current.scrollHeight - rightRef.current.clientHeight || 1);
      leftRef.current.scrollTop =
        ratio * (leftRef.current.scrollHeight - leftRef.current.clientHeight);
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  if (mode === "raw") {
    return (
      <div className={className}>
        <RawDiff diffs={diffs} />
      </div>
    );
  }

  return (
    <div
      className={cn("flex overflow-hidden rounded-md", className)}
      style={{ border: "1px solid var(--border-default)", minHeight: "240px" }}
    >
      <RenderedPane
        label="Before"
        content={before}
        scrollRef={leftRef}
        onScroll={syncLeft}
        side="before"
      />
      <div
        aria-hidden="true"
        className="w-px shrink-0"
        style={{ background: "var(--border-default)" }}
      />
      <RenderedPane
        label="After"
        content={after}
        scrollRef={rightRef}
        onScroll={syncRight}
        side="after"
      />
    </div>
  );
}
