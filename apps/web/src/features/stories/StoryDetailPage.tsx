import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Clock, Info, Pencil } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { LinkedEntityRef } from "@/components/shared/LinkedEntityRef";
import { ErrorState } from "@/components/shared/ErrorState";
import { PendingProposalBanner } from "@/components/shared/PendingProposalBanner";
import { useStoryDetail } from "./useStoryDetail";
import { useProposals } from "@/features/proposals/api";
import { usePermission } from "@/features/auth/useSession";
import { useShortcut } from "@/lib/shortcuts/useShortcut";
import { cn } from "@/lib/utils";

function DetailSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading story">
      <div className="sticky top-0 z-10 px-5 py-4 border-b flex flex-col gap-3"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}>
        <div className="h-3 w-40 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-64 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      <div className="p-6 flex flex-col gap-4 max-w-3xl">
        {[75, 60, 85, 50, 70].map((w, i) => (
          <div key={i} className="h-3 rounded animate-pulse" style={{ background: "var(--bg-surface-3)", width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

export function StoryDetailPage() {
  const { projectSlug = "", wombatId = "" } = useParams<{ projectSlug: string; wombatId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");

  const canPropose = usePermission(projectSlug, "content:propose");
  const { data: proposalsData } = useProposals(projectSlug, { content_id: wombatId, status: "open", limit: 1 });
  const openProposal = proposalsData?.data?.[0] ?? null;

  useShortcut("e", () => {
    if (canPropose && !openProposal) navigate(`/p/${projectSlug}/story/${wombatId}/edit`);
  }, { enabled: Boolean(canPropose && !openProposal) });

  const { data: story, isLoading, isError, error, refetch } = useStoryDetail(projectSlug, wombatId);

  if (isLoading) return <DetailSkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} className="m-6" />;
  if (!story) return null;

  const history = story.source?.history ?? [];

  // Extract TC references from body
  const linkedCaseIds: string[] = [];
  if (story.body) {
    const matches = Array.from(story.body.matchAll(/\[\[([A-Z]+-[A-Z0-9-]+)\]\]/g));
    matches.forEach((m) => { if (m[1] && m[1].startsWith("TC-")) linkedCaseIds.push(m[1]); });
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="sticky top-0 z-10 border-b px-5 py-3 flex flex-col gap-2"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
      >
        <AppBreadcrumb
          segments={[
            { label: "Stories", href: `/p/${projectSlug}/stories` },
            { label: story.wombat_id },
          ]}
          showHome
        />

        <div className="flex items-center gap-2">
          <h1 className="flex-1 min-w-0 text-[15px] font-semibold leading-snug tracking-tight"
            style={{ color: "var(--fg-default)" }}>
            {story.title}
          </h1>
          <span className="font-mono text-[11px] font-semibold shrink-0" style={{ color: "var(--chart-cat-4)" }}>
            {story.wombat_id}
          </span>
        </div>

        <div className="flex items-center gap-4 text-[12px]" style={{ color: "var(--fg-muted)" }}>
          {story.updated_at && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {new Date(story.updated_at).toLocaleDateString()}
            </span>
          )}
          {story.tags && story.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {story.tags.map((t) => (
                <span key={t} className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: "var(--bg-surface-2)", color: "var(--fg-muted)", border: "1px solid var(--border-subtle)" }}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {openProposal && (
          <PendingProposalBanner
            proposalId={openProposal.id}
            authorName={openProposal.author_user_id}
            ageIso={openProposal.created_at}
            projectSlug={projectSlug}
          />
        )}

        <div className="flex items-center gap-2">
          {canPropose ? (
            <button
              type="button"
              disabled={Boolean(openProposal)}
              onClick={() => navigate(`/p/${projectSlug}/story/${wombatId}/edit`)}
              title={openProposal ? "A proposal is already open" : "Edit this story"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 h-7 text-[12px] font-medium",
                "transition-colors duration-100 outline-none",
                "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
              style={{ background: "var(--bg-surface-2)", color: "var(--fg-muted)", border: "1px solid var(--border-default)" }}
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              {openProposal ? "Edit (proposal pending)" : "Edit"}
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px]"
              style={{ background: "var(--feedback-info-bg)", color: "var(--feedback-info-fg)", border: "1px solid color-mix(in srgb, var(--feedback-info-fg) 20%, transparent)" }}>
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Read-only — you do not have permission to propose changes.
            </div>
          )}
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList
          className="shrink-0 px-5 border-b rounded-none justify-start h-10 gap-0 bg-transparent"
          style={{ borderColor: "var(--border-default)" }}
        >
          {(["overview", "linked cases", "history"] as const).map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className={cn(
                "rounded-none border-b-2 px-4 py-2 text-[13px] font-medium capitalize transition-colors",
                "data-[state=active]:border-[color:var(--accent-primary)] data-[state=active]:text-[color:var(--accent-fg)]",
                "data-[state=inactive]:border-transparent data-[state=inactive]:text-[color:var(--fg-muted)]",
                "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              )}
            >
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="overview" className="p-6 max-w-3xl">
            {story.body ? (
              <MarkdownBody>{story.body}</MarkdownBody>
            ) : (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>No description provided.</p>
            )}
          </TabsContent>

          <TabsContent value="linked cases" className="p-6 max-w-2xl">
            {linkedCaseIds.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                  No linked testcases found in the story body.
                </p>
                <Link
                  to={`/p/${projectSlug}/search?q=${encodeURIComponent(story.wombat_id)}`}
                  className="text-[12px] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                  style={{ color: "var(--accent-fg)" }}
                >
                  Search for related testcases
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--fg-muted)" }}>
                  Referenced testcases
                </p>
                <div className="flex flex-wrap gap-2">
                  {linkedCaseIds.map((id) => (
                    <LinkedEntityRef
                      key={id}
                      entity={{
                        id,
                        title: id,
                        kind: "testcase",
                        href: `/p/${projectSlug}/library/${id}`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="p-6 max-w-2xl">
            {history.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>No revision history available.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {history.map((rev, i) => (
                  <li key={i} className="flex flex-col gap-1 rounded-md px-4 py-3 text-sm"
                    style={{ background: "var(--bg-surface-1)", border: "1px solid var(--border-default)" }}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--accent-fg)" }}>{rev.revision}</span>
                      {rev.date && <span className="text-[11px] tabular-nums" style={{ color: "var(--fg-muted)" }}>{new Date(rev.date).toLocaleDateString()}</span>}
                      {rev.author && <span className="text-[11px]" style={{ color: "var(--fg-muted)" }}>by {rev.author}</span>}
                    </div>
                    {rev.message && <p style={{ color: "var(--fg-default)" }}>{rev.message}</p>}
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
