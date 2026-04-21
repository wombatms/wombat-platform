/**
 * MarkdownEditor — CodeMirror 6 wrapper with Edit | Preview toggle.
 *
 * Design (from frontend-design skill):
 * - Edit | Preview segmented button group in the toolbar
 * - Edit mode: CodeMirror 6 minimal setup (markdown lang + basic extensions)
 * - Preview mode: the SP3.1 MarkdownBody component for sanitized rendering
 * - Theme: custom CSS overrides using SP3.1 CSS custom properties so dark/light
 *   modes switch automatically — no hardcoded colors
 * - Minimal UI chrome; focus is on the content
 */

import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* CodeMirror SP3.1 token theme                                        */
/* ------------------------------------------------------------------ */

/**
 * Creates a CodeMirror theme that maps CM's CSS vars to SP3.1 tokens.
 * We use EditorView.theme with `dark: false` and let the parent's
 * `data-theme` attribute (set by SP3.1 ThemeProvider) drive the tokens.
 */
function wombatTheme() {
  return EditorView.theme({
    "&": {
      color: "var(--fg-default)",
      background: "var(--bg-app)",
      height: "100%",
      fontSize: "13px",
      fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace",
    },
    ".cm-content": {
      caretColor: "var(--fg-default)",
      padding: "12px 16px",
    },
    ".cm-gutters": {
      background: "var(--bg-surface-1)",
      color: "var(--fg-disabled)",
      border: "none",
      borderRight: "1px solid var(--border-subtle)",
      minWidth: "40px",
    },
    ".cm-activeLineGutter": {
      background: "var(--bg-surface-2)",
      color: "var(--fg-muted)",
    },
    ".cm-activeLine": {
      background: "color-mix(in srgb, var(--accent-primary) 5%, transparent)",
    },
    ".cm-selectionBackground, ::selection": {
      background: "color-mix(in srgb, var(--accent-primary) 20%, transparent) !important",
    },
    ".cm-focused .cm-selectionBackground": {
      background: "color-mix(in srgb, var(--accent-primary) 25%, transparent) !important",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--fg-default)",
    },
    ".cm-line": {
      lineHeight: "1.65",
    },
    // Markdown-specific syntax highlighting via lezer tags
    ".tok-heading": { color: "var(--accent-fg)", fontWeight: "600" },
    ".tok-strong": { fontWeight: "700", color: "var(--fg-default)" },
    ".tok-emphasis": { fontStyle: "italic" },
    ".tok-link": { color: "var(--accent-fg)", textDecoration: "underline" },
    ".tok-monospace, .tok-code": {
      color: "var(--code-fg)",
      background: "var(--code-bg)",
      borderRadius: "3px",
      padding: "0 2px",
    },
    ".tok-comment": { color: "var(--fg-muted)" },
  });
}

/* ------------------------------------------------------------------ */
/* MarkdownEditor                                                       */
/* ------------------------------------------------------------------ */

export interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  minHeight?: number;
}

export function MarkdownEditor({
  value,
  onChange,
  className,
  placeholder,
  minHeight = 240,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Track whether the value update is coming from inside CM (to avoid loops)
  const internalUpdate = useRef(false);

  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        internalUpdate.current = true;
        onChange(update.state.doc.toString());
        internalUpdate.current = false;
      }
    });

    const placeholderExt = placeholder
      ? EditorView.domEventHandlers({
          focus() {},
        })
      : [];

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        highlightActiveLine(),
        markdown({ codeLanguages: [] }),
        wombatTheme(),
        updateListener,
        EditorView.lineWrapping,
        ...(Array.isArray(placeholderExt) ? placeholderExt : [placeholderExt]),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only mount once

  // Sync external value changes into CodeMirror without resetting cursor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || internalUpdate.current) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div className={cn("flex flex-col gap-0 overflow-hidden rounded-md", className)}
      style={{ border: "1px solid var(--border-default)" }}
    >
      {/* Toolbar */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-1.5"
        style={{
          background: "var(--bg-surface-2)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
          Markdown
        </span>

        <div
          className="flex items-center gap-0 rounded-md overflow-hidden"
          style={{ border: "1px solid var(--border-default)" }}
          role="group"
          aria-label="Editor mode"
        >
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="px-2.5 py-0.5 text-[11px] font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--focus-ring)]"
              style={
                mode === m
                  ? { background: "var(--accent-soft)", color: "var(--accent-fg)" }
                  : { background: "transparent", color: "var(--fg-muted)" }
              }
              aria-pressed={mode === m}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Edit pane — always mounted so CM state is preserved */}
      <div
        ref={editorRef}
        style={{
          display: mode === "edit" ? "flex" : "none",
          flexDirection: "column",
          minHeight,
          overflow: "auto",
          background: "var(--bg-app)",
        }}
        aria-label="Markdown editor"
      />

      {/* Preview pane */}
      {mode === "preview" && (
        <div
          className="overflow-auto p-4"
          style={{ minHeight, background: "var(--bg-app)" }}
          aria-label="Markdown preview"
        >
          {value ? (
            <MarkdownBody>{value}</MarkdownBody>
          ) : (
            <p className="text-[12px] italic" style={{ color: "var(--fg-muted)" }}>
              {placeholder ?? "Nothing to preview."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
