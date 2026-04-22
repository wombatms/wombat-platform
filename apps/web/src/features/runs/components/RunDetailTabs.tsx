/**
 * RunDetailTabs — URL-driven tab container for Run Detail.
 *
 * Three tabs: Cases | Evidence | Events.
 * Active tab is driven by `?tab=cases|evidence|events` (default: cases).
 *
 * Content areas are placeholders — Tasks 46, 47, and 48 fill them in.
 * Each placeholder renders its task number and the tab label so it is
 * visually distinct during development while still exercising the tab
 * routing logic fully.
 *
 * SP3.3 Task 45.
 */

import { useSearchParams } from "react-router-dom";
import { ListChecks, Image, Clock } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunTab = "cases" | "evidence" | "events";

const TAB_VALUES: RunTab[] = ["cases", "evidence", "events"];

function isRunTab(v: string | null): v is RunTab {
  return v === "cases" || v === "evidence" || v === "events";
}

interface RunDetailTabsProps {
  /** Slot filled by Task 46: RunCasesTable */
  casesContent?: React.ReactNode;
  /** Slot filled by Task 47: EvidenceGallery */
  evidenceContent?: React.ReactNode;
  /** Slot filled by Task 48: EventsList */
  eventsContent?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Placeholder (rendered until the task-specific component is provided)
// ---------------------------------------------------------------------------

interface TabPlaceholderProps {
  icon: React.ReactNode;
  label: string;
  taskNumber: number;
}

function TabPlaceholder({ icon, label, taskNumber }: TabPlaceholderProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-20 px-8 text-center"
      aria-label={`${label} tab placeholder`}
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{
          background: "var(--bg-surface-2)",
          color: "var(--fg-muted)",
        }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p
        className="text-sm font-medium"
        style={{ color: "var(--fg-default)" }}
      >
        {label}
      </p>
      <p
        className="text-xs"
        style={{ color: "var(--fg-muted)" }}
      >
        Implemented in Task {taskNumber}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab trigger with icon
// ---------------------------------------------------------------------------

interface TabTriggerProps {
  value: RunTab;
  icon: React.ReactNode;
  label: string;
}

function TabTriggerItem({ value, icon, label }: TabTriggerProps) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "inline-flex items-center gap-1.5",
      )}
    >
      <span
        className="shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5"
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </TabsTrigger>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RunDetailTabs({
  casesContent,
  evidenceContent,
  eventsContent,
}: RunDetailTabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: RunTab = isRunTab(rawTab) ? rawTab : "cases";

  const handleTabChange = (value: string) => {
    if (!isRunTab(value)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "cases") {
          // "cases" is the default — remove the param to keep URLs clean.
          next.delete("tab");
        } else {
          next.set("tab", value);
        }
        return next;
      },
      { replace: true },
    );
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="flex flex-col flex-1 min-h-0"
    >
      <div
        className="px-5 pt-3"
        style={{
          borderBottom: "1px solid var(--border-default)",
          background: "var(--bg-app)",
        }}
      >
        <TabsList className="gap-0.5">
          {TAB_VALUES.map((tab) => {
            const meta = TAB_META[tab];
            return (
              <TabTriggerItem
                key={tab}
                value={tab}
                icon={<meta.Icon />}
                label={meta.label}
              />
            );
          })}
        </TabsList>
      </div>

      {/* Cases */}
      <TabsContent
        value="cases"
        className="flex-1 min-h-0 overflow-auto mt-0 focus-visible:ring-0"
      >
        {casesContent ?? (
          <TabPlaceholder
            icon={<ListChecks className="h-5 w-5" />}
            label="Cases"
            taskNumber={46}
          />
        )}
      </TabsContent>

      {/* Evidence */}
      <TabsContent
        value="evidence"
        className="flex-1 min-h-0 overflow-auto mt-0 focus-visible:ring-0"
      >
        {evidenceContent ?? (
          <TabPlaceholder
            icon={<Image className="h-5 w-5" />}
            label="Evidence"
            taskNumber={47}
          />
        )}
      </TabsContent>

      {/* Events */}
      <TabsContent
        value="events"
        className="flex-1 min-h-0 overflow-auto mt-0 focus-visible:ring-0"
      >
        {eventsContent ?? (
          <TabPlaceholder
            icon={<Clock className="h-5 w-5" />}
            label="Events"
            taskNumber={48}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Tab metadata (icon constructors)
// ---------------------------------------------------------------------------

const TAB_META: Record<
  RunTab,
  { label: string; Icon: () => React.ReactElement }
> = {
  cases: {
    label: "Cases",
    Icon: () => <ListChecks />,
  },
  evidence: {
    label: "Evidence",
    Icon: () => <Image />,
  },
  events: {
    label: "Events",
    Icon: () => <Clock />,
  },
};
