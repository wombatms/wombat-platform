import { type ComponentType, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Info, Clock, GitBranch, User, ExternalLink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { StepTable } from "@/components/shared/StepTable";
import { LinkedEntityRef } from "@/components/shared/LinkedEntityRef";
import { ErrorState } from "@/components/shared/ErrorState";
import { PriorityBadge, AutomationBadge } from "@/components/shared/ResourceBadge";
import type { ResourcePriority, ResourceAutomation } from "@/components/shared/ResourceBadge";
import { useTestcaseDetail } from "./useTestcaseDetail";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

function DetailSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading testcase">
      {/* Header skeleton */}
      <div
        className="sticky top-0 z-10 px-5 py-4 border-b flex flex-col gap-3"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
      >
        <div className="h-3 w-48 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-72 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="flex gap-2">
          <div className="h-5 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div className="h-5 w-20 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        </div>
      </div>
      {/* Body skeleton */}
      <div className="p-6 flex flex-col gap-4 max-w-3xl">
        {[80, 65, 90, 55, 70].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)", width: `${w}%` }}
          />
        ))}
        <div className="mt-2 h-32 rounded-md animate-pulse" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border-default)" }} />
        {[60, 75, 50].map((w, i) => (
          <div
            key={`b-${i}`}
            className="h-3 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)", width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meta row                                                             */
/* ------------------------------------------------------------------ */

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--fg-muted)" }}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TestcaseDetailPage                                                   */
/* ------------------------------------------------------------------ */

export function TestcaseDetailPage() {
  const { projectSlug = "", wombatId = "" } = useParams<{
    projectSlug: string;
    wombatId: string;
  }>();

  const [activeTab, setActiveTab] = useState("overview");

  const {
    testcase: tc,
    isLoading,
    isError,
    error,
    refetch,
    resolveSharedStep,
  } = useTestcaseDetail(projectSlug, wombatId);

  if (isLoading) return <DetailSkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} className="m-6" />;
  if (!tc) return null;

  const steps = tc.steps ?? [];
  const history = tc.source?.history ?? [];
  // Extract linked entity refs from body (simple [[ID]] references)
  const linkedIds: string[] = [];
  if (tc.body) {
    const matches = Array.from(tc.body.matchAll(/\[\[([A-Z]+-[A-Z0-9-]+)\]\]/g));
    matches.forEach((m) => { if (m[1]) linkedIds.push(m[1]); });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <header
        className="sticky top-0 z-10 border-b px-5 py-3 flex flex-col gap-2"
        style={{
          background: "var(--bg-app)",
          borderColor: "var(--border-default)",
        }}
      >
        {/* Breadcrumb */}
        <AppBreadcrumb
          segments={[
            { label: "Test Library", href: `/p/${projectSlug}/library` },
            { label: tc.wombat_id },
          ]}
          showHome
        />

        {/* Title + badges */}
        <div className="flex flex-wrap items-start gap-2">
          <h1
            className="flex-1 min-w-0 text-[15px] font-semibold leading-snug tracking-tight"
            style={{ color: "var(--fg-default)" }}
          >
            {tc.title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {tc.priority && (
              <PriorityBadge priority={tc.priority as ResourcePriority} />
            )}
            {tc.automation && (
              <AutomationBadge automation={tc.automation as ResourceAutomation} />
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4">
          {tc.wombat_id && (
            <MetaItem icon={GitBranch} label="ID" value={tc.wombat_id} />
          )}
          {tc.source?.owner && (
            <MetaItem icon={User} label="Owner" value={tc.source.owner} />
          )}
          {tc.source?.revision && (
            <MetaItem icon={GitBranch} label="Rev" value={tc.source.revision} />
          )}
          {tc.updated_at && (
            <MetaItem
              icon={Clock}
              label="Updated"
              value={new Date(tc.updated_at).toLocaleDateString()}
            />
          )}
        </div>

        {/* Read-only notice */}
        <div
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px]"
          style={{
            background: "var(--feedback-info-bg)",
            color: "var(--feedback-info-fg)",
            border: "1px solid color-mix(in srgb, var(--feedback-info-fg) 20%, transparent)",
          }}
        >
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Read-only phase — editing comes in SP3.2.
        </div>
      </header>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <TabsList
          className="shrink-0 px-5 border-b rounded-none justify-start h-10 gap-0 bg-transparent"
          style={{ borderColor: "var(--border-default)" }}
        >
          {(["overview", "steps", "history", "links"] as const).map((tab) => (
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
              {tab === "steps" && steps.length > 0 && (
                <span
                  className="ml-1.5 text-[10px] font-semibold tabular-nums"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {steps.length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          {/* Overview */}
          <TabsContent value="overview" className="p-6 max-w-3xl">
            {tc.body ? (
              <MarkdownBody>{tc.body}</MarkdownBody>
            ) : (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                No description provided.
              </p>
            )}
          </TabsContent>

          {/* Steps */}
          <TabsContent value="steps" className="p-6">
            <StepTable
              steps={steps}
              resolveSharedStep={resolveSharedStep}
            />
          </TabsContent>

          {/* History */}
          <TabsContent value="history" className="p-6 max-w-2xl">
            {history.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                No revision history available.
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {history.map((rev, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-1 rounded-md px-4 py-3 text-sm"
                    style={{
                      background: "var(--bg-surface-1)",
                      border: "1px solid var(--border-default)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-[11px] font-semibold"
                        style={{ color: "var(--accent-fg)" }}
                      >
                        {rev.revision}
                      </span>
                      {rev.date && (
                        <span
                          className="text-[11px] tabular-nums"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {new Date(rev.date).toLocaleDateString()}
                        </span>
                      )}
                      {rev.author && (
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          by {rev.author}
                        </span>
                      )}
                    </div>
                    {rev.message && (
                      <p style={{ color: "var(--fg-default)" }}>{rev.message}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>

          {/* Links */}
          <TabsContent value="links" className="p-6 max-w-2xl">
            {linkedIds.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                No linked entities found.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p
                  className="text-[11px] uppercase tracking-wider font-semibold mb-2"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Referenced entities
                </p>
                <div className="flex flex-wrap gap-2">
                  {linkedIds.map((id) => {
                    const kind = id.startsWith("SS-")
                      ? "shared_step"
                      : id.startsWith("ST-")
                        ? "story"
                        : "testcase";
                    const basePath =
                      kind === "shared_step"
                        ? `/p/${projectSlug}/shared-steps`
                        : kind === "story"
                          ? `/p/${projectSlug}/stories`
                          : `/p/${projectSlug}/library`;

                    return (
                      <LinkedEntityRef
                        key={id}
                        entity={{
                          id,
                          title: id,
                          kind,
                          href: `${basePath}/${id}`,
                        }}
                      />
                    );
                  })}
                </div>
                <div className="mt-4">
                  <Link
                    to={`/p/${projectSlug}/search?q=${encodeURIComponent(tc.wombat_id)}`}
                    className="inline-flex items-center gap-1 text-[12px] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                    style={{ color: "var(--accent-fg)" }}
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    Find semantically related content
                  </Link>
                </div>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
