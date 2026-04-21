/**
 * PendingProposalBanner — non-obtrusive notice that an open proposal exists
 * for the current content item.
 *
 * Design (from frontend-design skill):
 * - Single-line layout on wide screens, stacks (avatar | meta | link) on narrow
 * - Muted amber/warning tone — not alarming, just informational
 * - Author initials in a small circle (no avatar images required)
 * - Relative age ("2 days ago") from the ageIso prop
 * - Links to /p/:slug/approvals/:proposalId
 */

import { Link } from "react-router-dom";
import { FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PendingProposalBannerProps {
  proposalId: string;
  authorName: string;
  /** ISO-8601 timestamp from created_at */
  ageIso: string;
  projectSlug: string;
  className?: string;
}

function relativeAge(isoDate: string): string {
  const delta = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function Initials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const letters =
    parts.length >= 2
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
      : name.slice(0, 2);
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase"
      style={{
        background: "color-mix(in srgb, var(--feedback-warn-fg) 20%, transparent)",
        color: "var(--feedback-warn-fg)",
      }}
      aria-hidden="true"
    >
      {letters.toUpperCase()}
    </span>
  );
}

export function PendingProposalBanner({
  proposalId,
  authorName,
  ageIso,
  projectSlug,
  className,
}: PendingProposalBannerProps) {
  const age = relativeAge(ageIso);
  const href = `/p/${projectSlug}/approvals/${proposalId}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[12px]",
        className,
      )}
      style={{
        background: "var(--feedback-warn-bg)",
        border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 25%, transparent)",
        color: "var(--feedback-warn-fg)",
      }}
    >
      <FileEdit className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />

      <Initials name={authorName} />

      <span>
        <strong className="font-semibold">{authorName}</strong> has an open
        proposal{" "}
        <span className="font-mono text-[10px]" style={{ color: "var(--fg-muted)" }}>
          {age}
        </span>
      </span>

      <Link
        to={href}
        className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
        style={{
          color: "var(--feedback-warn-fg)",
          background: "color-mix(in srgb, var(--feedback-warn-fg) 12%, transparent)",
        }}
      >
        Review
      </Link>
    </div>
  );
}
