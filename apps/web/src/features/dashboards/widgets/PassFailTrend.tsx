/**
 * PassFailTrend widget — recharts LineChart with 4 lines (SP3.4 Task 49).
 *
 * Design decisions (frontend-design skill):
 * - Line colors are injected from CSS variables via getComputedStyle so the
 *   chart respects light/dark theme without any JS theme-switching logic.
 * - Lines use a subtle dot only on hover (activeDot), no static dots, to
 *   keep the chart readable at dense data points.
 * - Area fill under pass line at low opacity gives a "health at a glance"
 *   sense without cluttering the chart.
 * - X-axis dates formatted as "MMM D" for concision; tooltip shows full date
 *   + all 4 values in a compact layout.
 * - Recharts ResponsiveContainer fills the WidgetFrame body area.
 */

import { useParams } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useWidget, type Scope, type Filters } from "../hooks";
import { WidgetFrame } from "../WidgetFrame";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrendPoint {
  date: string;
  pass: number;
  fail: number;
  blocked: number;
  skipped: number;
}

interface TrendData {
  points: TrendPoint[];
}

// ---------------------------------------------------------------------------
// Chart color tokens (resolved from CSS vars at render time)
// ---------------------------------------------------------------------------

const LINE_CONFIG = [
  { key: "pass",    label: "Pass",    cssVar: "--result-pass-fg" },
  { key: "fail",    label: "Fail",    cssVar: "--result-fail-fg" },
  { key: "blocked", label: "Blocked", cssVar: "--result-blocked-fg" },
  { key: "skipped", label: "Skipped", cssVar: "--result-skipped-fg" },
] as const;

function resolveChartColors(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const result: Record<string, string> = {};
  for (const cfg of LINE_CONFIG) {
    result[cfg.key] = style.getPropertyValue(cfg.cssVar).trim() || "#888";
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-md px-3 py-2 text-xs shadow-md"
      style={{
        background: "var(--bg-surface-1)",
        border: "1px solid var(--border-default)",
        color: "var(--fg-default)",
      }}
    >
      <p className="font-semibold mb-1.5" style={{ color: "var(--fg-muted)" }}>{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 leading-5">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ background: entry.color }}
          />
          <span style={{ color: "var(--fg-muted)" }}>{entry.name}:</span>
          <span className="font-semibold tabular-nums" style={{ color: "var(--fg-default)" }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PassFailTrendProps {
  scope: Scope;
  filters?: Filters;
}

export function PassFailTrend({ scope, filters = {} }: PassFailTrendProps) {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const slug = projectSlug ?? "";

  const { data, isLoading, error, refetch } = useWidget(
    slug,
    "passfail_trend",
    scope,
    filters,
  );

  const trendData = data as TrendData | undefined;
  const points = trendData?.points ?? [];
  const isEmpty = !isLoading && !error && points.length === 0;

  // Resolve colors lazily — only when we have data to render.
  const colors = !isLoading && !error && !isEmpty ? resolveChartColors() : {};

  return (
    <WidgetFrame
      title="Pass / fail trend"
      isLoading={isLoading}
      error={error}
      empty={isEmpty}
      emptyMessage="No run data in this window. Execute a run to see trend data."
      onRetry={() => void refetch()}
    >
      <div className="flex-1 px-2 py-3" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "var(--fg-muted)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => {
                const d = new Date(v);
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--fg-muted)" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={28}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={7}
              wrapperStyle={{ fontSize: "10px", color: "var(--fg-muted)", paddingTop: "4px" }}
            />
            {LINE_CONFIG.map(({ key, label }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={colors[key] ?? "#888"}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </WidgetFrame>
  );
}
