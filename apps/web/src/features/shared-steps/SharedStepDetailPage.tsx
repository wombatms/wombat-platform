import { useState } from "react";
import { useParams } from "react-router-dom";
import { Clock, Info } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { StepTable } from "@/components/shared/StepTable";
import { ErrorState } from "@/components/shared/ErrorState";
import { LinkedEntityRef } from "@/components/shared/LinkedEntityRef";
import { useSharedStepDetail } from "./useSharedStepDetail";
import { cn } from "@/lib/utils";

function DetailSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading shared step">
      <div className="sticky top-0 z-10 px-5 py-4 border-b flex flex-col gap-3"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}>
        <div className="h-3 w-48 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-64 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      <div className="p-6 flex flex-col gap-4 max-w-3xl">
        {[80, 65, 90, 55].map((w, i) => (
          <div key={i} className="h-3 rounded animate-pulse" style={{ background: "var(--bg-surface-3)", width: `${w}%` }} />
        ))}
        <div className="mt-2 h-32 rounded-md animate-pulse" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border-default)" }} />
      </div>
    </div>
  );
}

export function SharedStepDetailPage() {
  const { projectSlug = "", wombatId = "" } = useParams<{ projectSlug: string; wombatId: string }>();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: ss, isLoading, isError, error, refetch } = useSharedStepDetail(projectSlug, wombatId);

  if (isLoading) return <DetailSkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} className="m-6" />;
  if (!ss) return null;

  const steps = ss.steps ?? [];
  const history = ss.source?.history ?? [];

  return (
    <div className="flex flex-col h-full">
      <header
        className="sticky top-0 z-10 border-b px-5 py-3 flex flex-col gap-2"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
      >
        <AppBreadcrumb
          segments={[
            { label: "Shared Steps", href: `/p/${projectSlug}/shared-steps` },
            { label: ss.wombat_id },
          ]}
          showHome
        />

        <div className="flex items-center gap-2">
          <h1 className="flex-1 min-w-0 text-[15px] font-semibold leading-snug tracking-tight"
            style={{ color: "var(--fg-default)" }}>
            {ss.title}
          </h1>
          <span className="font-mono text-[11px] font-semibold shrink-0" style={{ color: "var(--feedback-info-fg)" }}>
            {ss.wombat_id}
          </span>
        </div>

        <div className="flex items-center gap-4 text-[12px]" style={{ color: "var(--fg-muted)" }}>
          {ss.updated_at && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {new Date(ss.updated_at).toLocaleDateString()}
            </span>
          )}
          {ss.tags && ss.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ss.tags.map((t) => (
                <span key={t} className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: "var(--bg-surface-2)", color: "var(--fg-muted)", border: "1px solid var(--border-subtle)" }}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px]"
          style={{ background: "var(--feedback-info-bg)", color: "var(--feedback-info-fg)", border: "1px solid color-mix(in srgb, var(--feedback-info-fg) 20%, transparent)" }}>
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Read-only phase — editing comes in SP3.2.
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList
          className="shrink-0 px-5 border-b rounded-none justify-start h-10 gap-0 bg-transparent"
          style={{ borderColor: "var(--border-default)" }}
        >
          {(["overview", "steps", "history", "where used"] as const).map((tab) => (
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
                <span className="ml-1.5 text-[10px] font-semibold tabular-nums" style={{ color: "var(--fg-muted)" }}>
                  {steps.length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="overview" className="p-6 max-w-3xl">
            {ss.body ? (
              <MarkdownBody>{ss.body}</MarkdownBody>
            ) : (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>No description provided.</p>
            )}
          </TabsContent>

          <TabsContent value="steps" className="p-6">
            <StepTable steps={steps} />
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

          <TabsContent value="where used" className="p-6 max-w-2xl">
            <div className="flex flex-col gap-3">
              <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--fg-muted)" }}>
                Testcases referencing this shared step
              </p>
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                Usage index is not available in SP3.1. Run a search to find references.
              </p>
              <LinkedEntityRef
                entity={{
                  id: ss.wombat_id,
                  title: ss.title,
                  kind: "shared_step",
                  href: `/p/${projectSlug}/search?q=${encodeURIComponent(ss.wombat_id)}`,
                }}
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
