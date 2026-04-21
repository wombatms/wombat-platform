import { useId, useRef, useState, type RefObject } from "react";
import { Copy, Check, Key, ChevronRight, ChevronDown, Zap, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCreateToken, type CreateTokenResponse } from "./useApiTokens";
import { useContext } from "react";
import { SessionContext } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

interface CreateTokenDialogProps {
  open: boolean;
  onClose: () => void;
}

type DialogPhase = "form" | "reveal";

export function CreateTokenDialog({ open, onClose }: CreateTokenDialogProps) {
  const nameId = useId();
  const scopeId = useId();
  const expiryId = useId();
  const purposeId = useId();

  // Use context directly so this renders safely in test environments without AuthProvider
  const session = useContext(SessionContext);
  const user = session?.user ?? null;
  // Admins are users who have any publish_direct permission — use a heuristic check
  // In SP3.1/3.2 there's no explicit "admin" flag; we check if the user has any
  // content:publish_direct perm across any project
  const isAdmin = user
    ? Object.values(user.permissions_by_project).some((perms) =>
        perms.includes("content:publish_direct"),
      )
    : false;

  const [phase, setPhase] = useState<DialogPhase>("form");
  const [name, setName] = useState("");
  const [scopeInput, setScopeInput] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [publishDirect, setPublishDirect] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [createdToken, setCreatedToken] = useState<CreateTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const tokenRef = useRef<HTMLElement>(null);

  const { mutate: createToken, isPending, error } = useCreateToken();

  const reset = () => {
    setPhase("form");
    setName("");
    setScopeInput("");
    setExpiresInDays("");
    setAdvancedOpen(false);
    setPublishDirect(false);
    setPurpose("");
    setCreatedToken(null);
    setCopied(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    if (publishDirect && !purpose.trim()) return; // validation: purpose required
    const scopes = scopeInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const days = expiresInDays ? parseInt(expiresInDays, 10) : null;

    createToken(
      {
        name: name.trim(),
        scopes,
        expires_in_days: days,
        publish_direct: publishDirect || undefined,
        purpose: publishDirect ? purpose.trim() : undefined,
      },
      {
        onSuccess: (data) => {
          setCreatedToken(data);
          setPhase("reveal");
        },
      },
    );
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.raw_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the token text
      if (tokenRef.current) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(tokenRef.current);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        {phase === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4 mt-2">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={nameId}
                  className="text-[12px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Name <span aria-hidden="true" style={{ color: "var(--feedback-error-fg)" }}>*</span>
                </label>
                <input
                  id={nameId}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. CI pipeline"
                  className={cn(
                    "h-9 rounded-md border px-3 text-[13px] outline-none",
                    "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
                    "focus-visible:border-[color:var(--focus-ring)]",
                    "placeholder:text-[color:var(--fg-disabled)]",
                  )}
                  style={{
                    background: "var(--bg-surface-1)",
                    border: "1px solid var(--border-default)",
                    color: "var(--fg-default)",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                />
              </div>

              {/* Scopes */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={scopeId}
                  className="text-[12px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Scopes
                </label>
                <input
                  id={scopeId}
                  type="text"
                  value={scopeInput}
                  onChange={(e) => setScopeInput(e.target.value)}
                  placeholder="read write (space or comma separated)"
                  className={cn(
                    "h-9 rounded-md border px-3 text-[13px] outline-none",
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
                <p className="text-[11px]" style={{ color: "var(--fg-disabled)" }}>
                  Leave blank for full access
                </p>
              </div>

              {/* Expiration */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={expiryId}
                  className="text-[12px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Expires in (days)
                </label>
                <input
                  id={expiryId}
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  placeholder="Leave blank for no expiry"
                  className={cn(
                    "h-9 rounded-md border px-3 text-[13px] outline-none",
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
              </div>

              {/* Advanced options (admin only) */}
              {isAdmin && (
                <div className="flex flex-col gap-0">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                    style={{ color: "var(--fg-muted)" }}
                    aria-expanded={advancedOpen}
                  >
                    {advancedOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Advanced options
                  </button>

                  {advancedOpen && (
                    <div className="mt-3 flex flex-col gap-3 pl-4 border-l" style={{ borderColor: "var(--border-default)" }}>
                      {/* Warning banner */}
                      <div
                        className="flex items-start gap-2 rounded-md px-3 py-2.5 text-[11px]"
                        style={{
                          background: "var(--feedback-warn-bg)",
                          border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 25%, transparent)",
                          color: "var(--feedback-warn-fg)",
                        }}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          Direct-publish tokens bypass the review queue. Use only for trusted automation.
                          All actions are recorded in the audit log.
                        </span>
                      </div>

                      {/* Checkbox */}
                      <div className="flex items-start gap-2.5">
                        <input
                          id="publish-direct-checkbox"
                          type="checkbox"
                          checked={publishDirect}
                          onChange={(e) => setPublishDirect(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded accent-[color:var(--accent-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] cursor-pointer"
                        />
                        <label
                          htmlFor="publish-direct-checkbox"
                          className="flex flex-col gap-0.5 cursor-pointer select-none"
                        >
                          <span className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: "var(--fg-default)" }}>
                            <Zap className="h-3.5 w-3.5" aria-hidden="true" style={{ color: "var(--feedback-warn-fg)" }} />
                            Grant direct-publish (bypass review)
                          </span>
                          <span className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
                            Allows this token to publish content without approval.
                          </span>
                        </label>
                      </div>

                      {/* Purpose field (required when checkbox is set) */}
                      {publishDirect && (
                        <div className="flex flex-col gap-1.5">
                          <label
                            htmlFor={purposeId}
                            className="text-[12px] font-semibold uppercase tracking-wider"
                            style={{ color: "var(--fg-muted)" }}
                          >
                            Purpose <span aria-hidden="true" style={{ color: "var(--feedback-error-fg)" }}>*</span>
                          </label>
                          <input
                            id={purposeId}
                            type="text"
                            value={purpose}
                            onChange={(e) => setPurpose(e.target.value)}
                            placeholder="e.g. Automated content pipeline for docs sync"
                            className={cn(
                              "h-9 rounded-md border px-3 text-[13px] outline-none",
                              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
                              "focus-visible:border-[color:var(--focus-ring)]",
                              "placeholder:text-[color:var(--fg-disabled)]",
                            )}
                            style={{
                              background: "var(--bg-surface-1)",
                              border: `1px solid ${publishDirect && !purpose.trim() ? "var(--feedback-error-fg)" : "var(--border-default)"}`,
                              color: "var(--fg-default)",
                            }}
                          />
                          {publishDirect && !purpose.trim() && (
                            <p className="text-[11px]" style={{ color: "var(--feedback-error-fg)" }}>
                              Purpose is required when granting direct-publish.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <p
                  className="text-[12px] rounded-md px-3 py-2"
                  style={{
                    background: "var(--feedback-error-bg)",
                    color: "var(--feedback-error-fg)",
                    border: "1px solid color-mix(in srgb, var(--feedback-error-fg) 20%, transparent)",
                  }}
                >
                  {error instanceof Error ? error.message : "Failed to create token"}
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={isPending}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreate}
                  disabled={!name.trim() || isPending || (publishDirect && !purpose.trim())}
                >
                  {isPending ? "Creating…" : "Create token"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-4 w-4 shrink-0" aria-hidden="true" style={{ color: "var(--feedback-success-fg)" }} />
                Token created
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4 mt-2">
              <div
                className="rounded-md px-4 py-3 text-[12px]"
                style={{
                  background: "var(--feedback-warn-bg)",
                  border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 25%, transparent)",
                  color: "var(--feedback-warn-fg)",
                }}
              >
                <strong>Copy your token now</strong> — it will not be shown again.
              </div>

              {/* Token display */}
              <div
                className="flex items-center gap-2 rounded-md px-3 py-2.5"
                style={{
                  background: "var(--code-bg)",
                  border: "1px solid var(--border-default)",
                }}
              >
                <code
                  ref={tokenRef as RefObject<HTMLElement>}
                  className="flex-1 min-w-0 break-all text-[12px] font-mono"
                  style={{ color: "var(--code-fg)" }}
                >
                  {createdToken?.raw_token}
                </code>
                <button
                  type="button"
                  aria-label={copied ? "Copied!" : "Copy token"}
                  onClick={() => void handleCopy()}
                  className={cn(
                    "shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
                    "transition-colors duration-120 outline-none",
                    "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                  )}
                  style={
                    copied
                      ? { background: "var(--feedback-success-bg)", color: "var(--feedback-success-fg)" }
                      : { background: "var(--bg-surface-2)", color: "var(--fg-muted)", border: "1px solid var(--border-default)" }
                  }
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="flex items-center justify-end pt-1">
                <Button variant="primary" size="sm" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
