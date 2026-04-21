import { type ReactNode, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  category: string;
  entries: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: "Global",
    entries: [
      { keys: ["⌘", "K"], description: "Open search palette" },
      { keys: ["g", "p"], description: "Go to projects" },
      { keys: ["g", "l"], description: "Go to library" },
      { keys: ["t"], description: "Toggle theme" },
      { keys: ["?"], description: "Show this help" },
    ],
  },
  {
    category: "List view",
    entries: [
      { keys: ["j", "/", "↓"], description: "Move selection down" },
      { keys: ["k", "/", "↑"], description: "Move selection up" },
      { keys: ["↵"], description: "Open selected item" },
      { keys: ["p"], description: "Toggle preview pane" },
      { keys: ["d"], description: "Toggle density" },
      { keys: ["/"], description: "Focus search" },
    ],
  },
  {
    category: "Content detail",
    entries: [
      { keys: ["e"], description: "Edit (when content:propose)" },
    ],
  },
  {
    category: "Approvals inbox",
    entries: [
      { keys: ["o"], description: "Open selected proposal" },
      { keys: ["a"], description: "Approve selected (admin only)" },
      { keys: ["r"], description: "Reject selected (admin only)" },
      { keys: ["w"], description: "Withdraw selected (author only)" },
    ],
  },
  {
    category: "Edit form",
    entries: [
      { keys: ["p"], description: "Publish directly (when content:publish_direct)" },
    ],
  },
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded text-[11px] font-mono font-medium"
      style={{
        background: "var(--bg-surface-2)",
        border: "1px solid var(--border-default)",
        color: "var(--fg-default)",
        boxShadow: "0 1px 0 var(--border-strong)",
      }}
    >
      {children}
    </kbd>
  );
}

function KeySequence({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {keys.map((key, i) => {
        if (key === "/") {
          return (
            <span key={i} className="text-[10px] px-0.5" style={{ color: "var(--fg-muted)" }}>
              or
            </span>
          );
        }
        return <Kbd key={i}>{key}</Kbd>;
      })}
    </div>
  );
}

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 mt-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.category} aria-labelledby={`shortcut-group-${group.category}`}>
              <h3
                id={`shortcut-group-${group.category}`}
                className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1"
                style={{ color: "var(--fg-muted)" }}
              >
                {group.category}
              </h3>
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--border-default)" }}
              >
                {group.entries.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-2.5 border-b last:border-0"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <span
                      className="text-[13px]"
                      style={{ color: "var(--fg-default)" }}
                    >
                      {entry.description}
                    </span>
                    <KeySequence keys={entry.keys} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * GlobalShortcutsOverlay — self-contained component that listens for `?`
 * and renders the overlay. Mount once inside AppShell or the authenticated layout.
 */
export function GlobalShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (
        tgt.tagName === "INPUT" ||
        tgt.tagName === "TEXTAREA" ||
        tgt.isContentEditable
      )
        return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return <ShortcutsOverlay open={open} onClose={() => setOpen(false)} />;
}
