import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as ReactMarkdownOptions } from "react-markdown";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Sanitize schema                                                       */
/* ------------------------------------------------------------------ */

/**
 * Extended from rehype-sanitize's defaultSchema.
 * Allows:
 *   - <input type="checkbox"> for GFM task lists (read-only)
 *   - <a href="https?://..."> and data: URIs for img src
 *   - <code>, <pre>, <table>, <img>
 * Blocks:
 *   - <script>, <style>, on* attrs, javascript: hrefs
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Allow type=checkbox on input (GFM task lists)
    input: [["type", "checkbox"]],
    // Allow safe img src
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      ["src", /^https?:\/\//, /^data:image\//],
      "alt",
      "title",
    ],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["href", /^https?:\/\//, /^\//, /^#/],
      "title",
      "target",
    ],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
  },
  // Remove on* event handlers implicitly handled by defaultSchema strip
  strip: [...(defaultSchema.strip ?? []), "script", "style"],
};

/* ------------------------------------------------------------------ */
/* Custom renderers                                                      */
/* ------------------------------------------------------------------ */

const components: ReactMarkdownOptions["components"] = {
  // ── Headings ────────────────────────────────────────────────────────
  h1: ({ children }) => (
    <h1
      className="mb-3 mt-6 text-[17px] font-semibold tracking-tight leading-snug first:mt-0"
      style={{
        color: "var(--fg-default)",
        borderBottom: "1px solid var(--border-subtle)",
        paddingBottom: "0.35em",
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      className="mb-2.5 mt-5 text-[15px] font-semibold tracking-tight leading-snug first:mt-0"
      style={{ color: "var(--fg-default)" }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      className="mb-2 mt-4 text-[13px] font-semibold uppercase tracking-wider first:mt-0"
      style={{ color: "var(--fg-muted)" }}
    >
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4
      className="mb-1.5 mt-3 text-sm font-semibold first:mt-0"
      style={{ color: "var(--fg-default)" }}
    >
      {children}
    </h4>
  ),

  // ── Paragraph ───────────────────────────────────────────────────────
  p: ({ children }) => (
    <p
      className="mb-3 text-sm leading-[1.65] last:mb-0"
      style={{ color: "var(--fg-default)" }}
    >
      {children}
    </p>
  ),

  // ── Inline code ─────────────────────────────────────────────────────
  code: ({ children, className }) => {
    // Fenced code blocks arrive with a language-* className
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      // Block case is handled by the `pre` renderer
      return (
        <code
          className={cn("text-[12px] font-mono leading-relaxed block", className)}
          style={{ color: "var(--code-fg)" }}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded px-1.5 py-0.5 text-[12px] font-mono"
        style={{
          background: "var(--code-bg)",
          color: "var(--code-fg)",
          border: "1px solid var(--border-default)",
        }}
      >
        {children}
      </code>
    );
  },

  // ── Fenced code block ───────────────────────────────────────────────
  pre: ({ children }) => (
    <pre
      className="group relative mb-3 overflow-x-auto rounded-md text-[12px] leading-relaxed"
      style={{
        background: "var(--code-bg)",
        border: "1px solid var(--border-default)",
        borderLeft: "3px solid var(--border-strong)",
        color: "var(--code-fg)",
        padding: "0.75rem 1rem",
        fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace",
      }}
    >
      {children}
    </pre>
  ),

  // ── Blockquote ──────────────────────────────────────────────────────
  blockquote: ({ children }) => (
    <blockquote
      className="mb-3 py-1 pl-4"
      style={{
        borderLeft: "3px solid var(--accent-primary)",
        color: "var(--fg-muted)",
        background: "var(--accent-soft)",
        borderRadius: "0 4px 4px 0",
      }}
    >
      {children}
    </blockquote>
  ),

  // ── Lists ────────────────────────────────────────────────────────────
  ul: ({ children }) => (
    <ul
      className="mb-3 list-disc pl-5 text-sm leading-[1.65]"
      style={{ color: "var(--fg-default)" }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol
      className="mb-3 list-decimal pl-5 text-sm leading-[1.65]"
      style={{ color: "var(--fg-default)" }}
    >
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="mb-0.5">{children}</li>,

  // ── Task list checkbox ───────────────────────────────────────────────
  input: ({ type, checked }) => {
    if (type === "checkbox") {
      return (
        <input
          type="checkbox"
          readOnly
          checked={checked}
          disabled
          className="mr-1.5 align-middle"
          aria-disabled="true"
        />
      );
    }
    return null;
  },

  // ── Table ────────────────────────────────────────────────────────────
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-md" style={{ border: "1px solid var(--border-default)" }}>
      <table className="w-full text-sm border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: "var(--bg-surface-2)" }}>{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
      className="last:border-0"
    >
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th
      className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--fg-muted)", borderRight: "1px solid var(--border-subtle)" }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      className="px-3 py-2 text-sm"
      style={{
        color: "var(--fg-default)",
        borderRight: "1px solid var(--border-subtle)",
      }}
    >
      {children}
    </td>
  ),

  // ── Horizontal rule ──────────────────────────────────────────────────
  hr: () => (
    <hr
      className="my-5"
      style={{ borderColor: "var(--border-default)", borderTopWidth: 1 }}
    />
  ),

  // ── Links ────────────────────────────────────────────────────────────
  a: ({ href, children, title }) => (
    <a
      href={href}
      title={title}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      className="underline underline-offset-2 decoration-[color:var(--border-strong)] transition-colors"
      style={{ color: "var(--accent-fg)" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.textDecorationColor =
          "var(--accent-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.textDecorationColor =
          "var(--border-strong)";
      }}
    >
      {children}
    </a>
  ),

  // ── Images ───────────────────────────────────────────────────────────
  img: ({ src, alt, title }) => (
    <img
      src={src}
      alt={alt ?? ""}
      title={title}
      className="max-w-full rounded-md my-2"
      style={{ border: "1px solid var(--border-default)" }}
      loading="lazy"
    />
  ),

  // ── Strong / em ──────────────────────────────────────────────────────
  strong: ({ children }) => (
    <strong className="font-semibold" style={{ color: "var(--fg-default)" }}>
      {children}
    </strong>
  ),
  em: ({ children }) => (
    <em className="italic" style={{ color: "var(--fg-default)" }}>
      {children}
    </em>
  ),
};

/* ------------------------------------------------------------------ */
/* MarkdownBody                                                          */
/* ------------------------------------------------------------------ */

interface MarkdownBodyProps {
  children: string;
  className?: string;
}

/**
 * MarkdownBody — sanitized, token-driven Markdown renderer.
 *
 * Security:
 * - All HTML is run through rehype-sanitize before render.
 * - <script> and on* event handlers are stripped.
 * - <a href="javascript:..."> is blocked by the allow-list.
 * - <img src> is restricted to http(s): and data:image/.
 *
 * Typography:
 * - 14px base with 1.65 line-height for comfortable reading.
 * - Monospace: ui-monospace stack, no web font.
 * - Code blocks scroll horizontally; never overflow the container.
 */
export function MarkdownBody({ children, className }: MarkdownBodyProps) {
  return (
    <div
      className={cn("markdown-body max-w-none", className)}
      style={{ color: "var(--fg-default)" }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
