/**
 * EditForm — create or update a proposal for a content item.
 *
 * Design (from frontend-design skill):
 * - Structured frontmatter form: title, priority, tags, summary
 * - MarkdownEditor for the body below
 * - Prominent info banner (read the proposal flow)
 * - Two primary actions when user has content:publish_direct:
 *     1. "Propose change" → useCreateProposal
 *     2. "Publish directly" → useDirectPublish
 *   Otherwise: just "Propose change"
 * - 409 open_proposal_exists → banner with link
 * - 409 stale_base_revision → navigate to conflict workspace
 * - Routes: /p/:slug/:kind/:wombatId/edit (edit) and /p/:slug/:kind/new (create)
 */

import type { ReactNode } from "react";
import { useState, useCallback, useId } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Info, AlertCircle, Zap } from "lucide-react";
import { MarkdownEditor } from "./MarkdownEditor";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/ErrorState";
import { useCreateProposal, useDirectPublish } from "./api";
import { ConflictError, OpenProposalExistsError } from "./errors";
import { usePermission } from "@/features/auth/useSession";
import { useTestcaseDetail } from "@/features/library/useTestcaseDetail";
import { useSharedStepDetail } from "@/features/shared-steps/useSharedStepDetail";
import { useStoryDetail } from "@/features/stories/useStoryDetail";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

type ContentKind = "testcase" | "shared_step" | "story";

function kindLabel(kind: ContentKind): string {
  switch (kind) {
    case "testcase": return "Test Case";
    case "shared_step": return "Shared Step";
    case "story": return "Story";
  }
}

function kindBasePath(kind: ContentKind): string {
  switch (kind) {
    case "testcase": return "library";
    case "shared_step": return "shared-steps";
    case "story": return "stories";
  }
}

/* ------------------------------------------------------------------ */
/* Content loader — delegates to the appropriate SP3.1 detail hook     */
/* ------------------------------------------------------------------ */

interface LoadedContent {
  title: string;
  body: string;
  priority?: string;
  tags?: string[];
  base_revision?: string;
  raw: Record<string, unknown>;
}

function useContentForEdit(
  slug: string,
  kind: ContentKind,
  wombatId: string,
  isNew: boolean,
): { content: LoadedContent | null; isLoading: boolean; isError: boolean; error: unknown } {
  const tcResult = useTestcaseDetail(isNew || kind !== "testcase" ? "" : slug, wombatId);
  const ssResult = useSharedStepDetail(slug, isNew || kind !== "shared_step" ? "" : wombatId);
  const stResult = useStoryDetail(slug, isNew || kind !== "story" ? "" : wombatId);

  if (isNew) {
    return { content: { title: "", body: "", raw: {} }, isLoading: false, isError: false, error: null };
  }

  if (kind === "testcase") {
    const tc = tcResult.testcase;
    return {
      content: tc
        ? {
            title: tc.title,
            body: tc.body ?? "",
            priority: tc.priority,
            tags: tc.tags,
            base_revision: tc.source?.revision,
            raw: tc as unknown as Record<string, unknown>,
          }
        : null,
      isLoading: tcResult.isLoading,
      isError: tcResult.isError,
      error: tcResult.error,
    };
  }

  if (kind === "shared_step") {
    const ss = ssResult.data;
    return {
      content: ss
        ? {
            title: ss.title,
            body: ss.body ?? "",
            tags: ss.tags,
            base_revision: ss.source?.revision,
            raw: ss as unknown as Record<string, unknown>,
          }
        : null,
      isLoading: ssResult.isLoading,
      isError: ssResult.isError,
      error: ssResult.error,
    };
  }

  // story
  const st = stResult.data;
  return {
    content: st
      ? {
          title: st.title,
          body: st.body ?? "",
          tags: st.tags,
          base_revision: st.source?.revision,
          raw: st as unknown as Record<string, unknown>,
        }
      : null,
    isLoading: stResult.isLoading,
    isError: stResult.isError,
    error: stResult.error,
  };
}

/* ------------------------------------------------------------------ */
/* Form fields                                                          */
/* ------------------------------------------------------------------ */

function FieldLabel({ htmlFor, children, required }: { htmlFor: string; children: ReactNode; required?: boolean }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[12px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--fg-muted)" }}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5" style={{ color: "var(--feedback-error-fg)" }}>*</span>
      )}
    </label>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "h-9 rounded-md border px-3 text-[13px] outline-none w-full",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
        "focus-visible:border-[color:var(--focus-ring)]",
        "placeholder:text-[color:var(--fg-disabled)]",
      )}
      style={{
        background: "var(--bg-surface-1)",
        border: "1px solid var(--border-default)",
        color: "var(--fg-default)",
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* EditForm page                                                        */
/* ------------------------------------------------------------------ */

export function EditForm() {
  const { projectSlug = "", kind: rawKind = "testcase", wombatId } = useParams<{
    projectSlug: string;
    kind: string;
    wombatId?: string;
  }>();
  const navigate = useNavigate();
  const kind = rawKind as ContentKind;
  const isNew = !wombatId;

  const titleId = useId();
  const tagsId = useId();
  const summaryId = useId();

  const canPublishDirect = usePermission(projectSlug, "content:publish_direct");

  const { content, isLoading, isError, error } = useContentForEdit(
    projectSlug,
    kind,
    wombatId ?? "",
    isNew,
  );

  const [title, setTitle] = useState(content?.title ?? "");
  const [body, setBody] = useState(content?.body ?? "");
  const [tagsInput, setTagsInput] = useState((content?.tags ?? []).join(", "));
  const [summary, setSummary] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [openProposalId, setOpenProposalId] = useState<string | null>(null);

  const { mutate: createProposal, isPending: proposing } = useCreateProposal(projectSlug);
  const { mutate: publishDirect, isPending: publishing } = useDirectPublish(projectSlug);

  // Once data loads, seed form if still blank
  const seeded = useState(false);
  if (content && !seeded[0]) {
    seeded[1](true);
    setTitle(content.title);
    setBody(content.body);
    setTagsInput((content.tags ?? []).join(", "));
  }

  const buildBody = useCallback((): Record<string, unknown> => {
    const tags = tagsInput
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return { ...content?.raw, title, body, tags };
  }, [content?.raw, title, body, tagsInput]);

  const handlePropose = useCallback(() => {
    setSubmitError(null);
    setOpenProposalId(null);
    const proposed_body = buildBody();

    createProposal(
      {
        kind: kind === "testcase" ? "testcase" : kind === "shared_step" ? "shared_step" : "story",
        content_id: wombatId,
        source_path: "",
        base_revision: content?.base_revision ?? "",
        proposed_title: title,
        proposed_body,
        summary: summary.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          navigate(`/p/${projectSlug}/approvals/${data.proposal.id}`);
        },
        onError: (err) => {
          if (err instanceof OpenProposalExistsError) {
            setOpenProposalId(err.existingProposalId);
          } else if (err instanceof ConflictError) {
            navigate(`/p/${projectSlug}/approvals/${err.currentSha}/rebase`);
          } else {
            setSubmitError(err instanceof Error ? err.message : "Failed to create proposal");
          }
        },
      },
    );
  }, [buildBody, createProposal, kind, wombatId, content?.base_revision, title, summary, navigate, projectSlug]);

  const handlePublishDirect = useCallback(() => {
    setSubmitError(null);
    setOpenProposalId(null);
    const proposed_body = buildBody();

    publishDirect(
      {
        kind: kind === "testcase" ? "testcase" : kind === "shared_step" ? "shared_step" : "story",
        content_id: wombatId,
        source_path: "",
        base_revision: content?.base_revision ?? "",
        proposed_title: title,
        proposed_body,
        summary: summary.trim() || undefined,
      },
      {
        onSuccess: () => {
          const base = kindBasePath(kind);
          navigate(wombatId ? `/p/${projectSlug}/${base}/${wombatId}` : `/p/${projectSlug}/${base}`);
        },
        onError: (err) => {
          if (err instanceof ConflictError) {
            navigate(`/p/${projectSlug}/approvals/${err.currentSha}/rebase`);
          } else {
            setSubmitError(err instanceof Error ? err.message : "Failed to publish");
          }
        },
      },
    );
  }, [buildBody, publishDirect, kind, wombatId, content?.base_revision, title, summary, navigate, projectSlug]);

  if (isLoading) {
    return (
      <div className="p-6 flex flex-col gap-5 max-w-3xl" aria-busy="true" aria-label="Loading">
        {[40, 40, 80, 200].map((h, i) => (
          <div key={i} className="rounded-md animate-pulse" style={{ height: h, background: "var(--bg-surface-2)", border: "1px solid var(--border-default)" }} />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => {}} className="m-6" />;
  }

  const base = kindBasePath(kind);
  const isPending = proposing || publishing;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b px-5 py-3 flex flex-col gap-2"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
      >
        <AppBreadcrumb
          segments={[
            { label: kindLabel(kind), href: `/p/${projectSlug}/${base}` },
            ...(wombatId
              ? [{ label: wombatId, href: `/p/${projectSlug}/${base}/${wombatId}` }]
              : []),
            { label: isNew ? `New ${kindLabel(kind)}` : "Edit" },
          ]}
          showHome
        />
        <h1
          className="text-[15px] font-semibold tracking-tight"
          style={{ color: "var(--fg-default)" }}
        >
          {isNew ? `New ${kindLabel(kind)}` : `Edit — ${title || wombatId}`}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-6 max-w-3xl">
          {/* Info banner */}
          <div
            className="flex items-start gap-2.5 rounded-md px-4 py-3 text-[12px]"
            style={{
              background: "var(--feedback-info-bg)",
              border: "1px solid color-mix(in srgb, var(--feedback-info-fg) 25%, transparent)",
              color: "var(--feedback-info-fg)",
            }}
          >
            <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Changes you submit here create a proposal that must be approved before publishing.
              {canPublishDirect && " As a direct-publisher, you may also bypass review."}
            </span>
          </div>

          {/* Open-proposal banner */}
          {openProposalId && (
            <div
              className="flex items-start gap-2.5 rounded-md px-4 py-3 text-[12px]"
              style={{
                background: "var(--feedback-warn-bg)",
                border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 25%, transparent)",
                color: "var(--feedback-warn-fg)",
              }}
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                A proposal is already open for this content.{" "}
                <Link
                  to={`/p/${projectSlug}/approvals/${openProposalId}`}
                  className="underline underline-offset-2 font-semibold"
                >
                  View existing proposal
                </Link>
              </span>
            </div>
          )}

          {/* Frontmatter fields */}
          <section className="flex flex-col gap-4">
            <h2
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--fg-muted)" }}
            >
              Metadata
            </h2>

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={titleId} required>Title</FieldLabel>
              <TextInput
                id={titleId}
                value={title}
                onChange={setTitle}
                placeholder="Content title"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={tagsId}>Tags</FieldLabel>
              <TextInput
                id={tagsId}
                value={tagsInput}
                onChange={setTagsInput}
                placeholder="tag1, tag2 (comma or space separated)"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={summaryId}>Proposal summary</FieldLabel>
              <TextInput
                id={summaryId}
                value={summary}
                onChange={setSummary}
                placeholder="Brief description of changes (optional)"
              />
            </div>
          </section>

          {/* Body editor */}
          <section className="flex flex-col gap-2">
            <h2
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--fg-muted)" }}
            >
              Body (Markdown)
            </h2>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              placeholder="Write the content body in Markdown…"
              minHeight={320}
            />
          </section>

          {/* Error */}
          {submitError && (
            <div
              className="flex items-start gap-2 rounded-md px-4 py-3 text-[12px]"
              style={{
                background: "var(--feedback-error-bg)",
                border: "1px solid color-mix(in srgb, var(--feedback-error-fg) 20%, transparent)",
                color: "var(--feedback-error-fg)",
              }}
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              disabled={isPending}
            >
              Cancel
            </Button>

            <div className="flex items-center gap-2 ml-auto">
              {canPublishDirect && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePublishDirect}
                  disabled={!title.trim() || isPending}
                  className="gap-1.5"
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  {publishing ? "Publishing…" : "Publish directly"}
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={handlePropose}
                disabled={!title.trim() || isPending}
              >
                {proposing ? "Proposing…" : "Propose change"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
