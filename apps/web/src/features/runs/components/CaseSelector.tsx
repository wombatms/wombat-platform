/**
 * CaseSelector — three-tab case picker for Create Run.
 *
 * Tabs: Filter | Paste IDs | From Library
 *
 * Selected state (`selected: Set<string>`) is owned here and exposed via
 * `onSelectionChange`. All three tabs receive `selected` + mutators so they
 * share a single source of truth.
 *
 * The tab panel is scrollable; the tab strip is sticky at the top of the panel.
 */

import { useCallback, useState } from "react";
import { ListFilter, ClipboardList, BookOpen } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FilterTab } from "./CaseSelector.FilterTab";
import { PasteTab } from "./CaseSelector.PasteTab";
import { LibraryTab } from "./CaseSelector.LibraryTab";
import { cn } from "@/lib/utils";

export type CaseSelectorTab = "filter" | "paste" | "library";

export interface CaseSelectorProps {
  projectSlug: string;
  /** Called whenever the selected set changes. */
  onSelectionChange: (selected: Set<string>) => void;
  className?: string;
}

export function CaseSelector({
  projectSlug,
  onSelectionChange,
  className,
}: CaseSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<CaseSelectorTab>("filter");

  // Toggle a single ID
  const handleToggle = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        onSelectionChange(next);
        return next;
      });
    },
    [onSelectionChange],
  );

  // Add multiple IDs (union with existing)
  const handleSelectIds = useCallback(
    (ids: string[]) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        onSelectionChange(next);
        return next;
      });
    },
    [onSelectionChange],
  );

  // Remove multiple IDs
  const handleDeselectIds = useCallback(
    (ids: string[]) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        onSelectionChange(next);
        return next;
      });
    },
    [onSelectionChange],
  );

  return (
    <div
      className={cn("flex flex-col rounded-lg border overflow-hidden", className)}
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-2)",
        }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          Case selection
        </span>
        {selected.size > 0 && (
          <SelectedBadge count={selected.size} />
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as CaseSelectorTab)}
        className="flex flex-col flex-1 overflow-hidden"
      >
        {/* Tab strip — sticky */}
        <div
          className="border-b px-3 pt-2 pb-0"
          style={{ borderColor: "var(--border-default)" }}
        >
          <TabsList className="h-8 gap-0 rounded-none bg-transparent p-0">
            <SelectorTab value="filter" icon={<ListFilter className="h-3.5 w-3.5" />} label="Filter" />
            <SelectorTab value="paste" icon={<ClipboardList className="h-3.5 w-3.5" />} label="Paste IDs" />
            <SelectorTab value="library" icon={<BookOpen className="h-3.5 w-3.5" />} label="From Library" />
          </TabsList>
        </div>

        {/* Tab contents — scrollable */}
        <div className="flex-1 overflow-hidden">
          <TabsContent
            value="filter"
            className="h-full overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <FilterTab
              projectSlug={projectSlug}
              selected={selected}
              onToggle={handleToggle}
              onSelectIds={handleSelectIds}
            />
          </TabsContent>

          <TabsContent
            value="paste"
            className="h-full overflow-y-auto mt-0"
          >
            <PasteTab
              projectSlug={projectSlug}
              selected={selected}
              onSelectIds={handleSelectIds}
              onDeselectIds={handleDeselectIds}
            />
          </TabsContent>

          <TabsContent
            value="library"
            className="h-full overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <LibraryTab
              projectSlug={projectSlug}
              selected={selected}
              onToggle={handleToggle}
              onSelectIds={handleSelectIds}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectorTab — styled tab trigger for the three-tab header
// ---------------------------------------------------------------------------

interface SelectorTabProps {
  value: string;
  icon: React.ReactNode;
  label: string;
}

function SelectorTab({ value, icon, label }: SelectorTabProps) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-none border-b-2 px-3 h-8",
        "text-xs font-medium tracking-tight",
        "bg-transparent shadow-none",
        "transition-[color,border-color] duration-150",
        "data-[state=inactive]:border-transparent data-[state=inactive]:text-[color:var(--fg-muted)]",
        "data-[state=active]:border-[color:var(--accent-primary)] data-[state=active]:text-[color:var(--fg-default)]",
        "data-[state=active]:bg-transparent data-[state=active]:shadow-none",
        "hover:text-[color:var(--fg-default)]",
      )}
    >
      {icon}
      {label}
    </TabsTrigger>
  );
}

// ---------------------------------------------------------------------------
// SelectedBadge — small count chip shown in the panel header
// ---------------------------------------------------------------------------

function SelectedBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
      style={{
        background: "var(--accent-primary)",
        color: "var(--fg-inverse)",
      }}
      aria-label={`${count} cases selected`}
    >
      {count} selected
    </span>
  );
}
