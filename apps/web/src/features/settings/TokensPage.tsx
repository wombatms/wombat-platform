import { useState } from "react";
import { Key, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { CreateTokenDialog } from "./CreateTokenDialog";
import { useApiTokens, useRevokeToken, type ApiToken } from "./useApiTokens";
import { cn } from "@/lib/utils";

function TokensSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-6 max-w-2xl" aria-busy="true" aria-label="Loading tokens">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border p-4 flex items-center gap-4"
          style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)" }}>
          <div className="h-4 w-32 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div className="h-4 w-20 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div className="ml-auto h-7 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        </div>
      ))}
    </div>
  );
}

function TokenRow({ token }: { token: ApiToken }) {
  const [confirming, setConfirming] = useState(false);
  const { mutate: revoke, isPending } = useRevokeToken();

  const handleRevoke = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    revoke(token.id, { onSuccess: () => setConfirming(false) });
  };

  return (
    <div
      className="rounded-lg border px-4 py-3.5 flex items-start gap-4"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
      }}
    >
      <Key
        className="h-4 w-4 shrink-0 mt-0.5"
        aria-hidden="true"
        style={{ color: "var(--fg-muted)" }}
      />

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <p
          className="text-[13px] font-semibold"
          style={{ color: "var(--fg-default)" }}
        >
          {token.name}
        </p>

        <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--fg-muted)" }}>
          <span>
            Created {new Date(token.created_at).toLocaleDateString()}
          </span>
          {token.expires_at ? (
            <span>
              Expires {new Date(token.expires_at).toLocaleDateString()}
            </span>
          ) : (
            <span style={{ color: "var(--fg-disabled)" }}>No expiry</span>
          )}
          {token.scopes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {token.scopes.map((s) => (
                <span
                  key={s}
                  className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    background: "var(--bg-surface-2)",
                    color: "var(--fg-muted)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Revoke */}
      <div className="flex items-center gap-2 shrink-0">
        {confirming && (
          <span className="text-[11px]" style={{ color: "var(--feedback-error-fg)" }}>
            Confirm?
          </span>
        )}
        <button
          type="button"
          aria-label={confirming ? "Confirm revoke" : `Revoke token ${token.name}`}
          onClick={handleRevoke}
          disabled={isPending}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 h-7 text-[12px] font-medium",
            "transition-colors duration-120 outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
          style={
            confirming
              ? {
                  background: "var(--feedback-error-bg)",
                  color: "var(--feedback-error-fg)",
                  border: "1px solid color-mix(in srgb, var(--feedback-error-fg) 30%, transparent)",
                }
              : {
                  background: "transparent",
                  color: "var(--fg-muted)",
                  border: "1px solid var(--border-default)",
                }
          }
          onBlur={() => { if (confirming) setTimeout(() => setConfirming(false), 200); }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {isPending ? "Revoking…" : confirming ? "Revoke" : "Revoke"}
        </button>
        {confirming && (
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-[11px] underline outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function TokensPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: tokens, isLoading, isError, error, refetch } = useApiTokens();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="API Tokens"
        subtitle="Create and manage personal API tokens"
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create new token
          </Button>
        }
      />

      <div className="p-6 max-w-2xl">
        {isLoading ? (
          <TokensSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !tokens || tokens.length === 0 ? (
          <EmptyState
            icon={<Key className="h-4 w-4" aria-hidden="true" />}
            title="No API tokens"
            description="Create a token to authenticate with the Wombat API."
            action={
              <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Create token
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {tokens.map((token) => (
              <TokenRow key={token.id} token={token} />
            ))}
          </div>
        )}
      </div>

      <CreateTokenDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
