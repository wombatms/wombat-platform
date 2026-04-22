import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Environment } from "../hooks/environments";

interface DeleteEnvironmentDialogProps {
  /** The environment to delete, or null when dialog is closed */
  environment: Environment | null;
  onClose: () => void;
  onConfirm: (env: Environment) => void;
  /** Whether the delete mutation is in flight */
  isPending?: boolean;
}

/**
 * DeleteEnvironmentDialog — confirms hard-delete of a named environment.
 *
 * Prominently warns that existing runs which referenced this environment
 * will have their environment_id FK go NULL — they are not deleted, but
 * the association is lost permanently.
 *
 * Admin-only: the parent (EnvironmentsTable) is responsible for only
 * rendering the trigger for admin users.
 */
export function DeleteEnvironmentDialog({
  environment,
  onClose,
  onConfirm,
  isPending = false,
}: DeleteEnvironmentDialogProps) {
  const isOpen = environment !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete environment</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Warning callout */}
          <div
            className="flex gap-3 rounded-lg px-4 py-3"
            style={{
              background: "var(--feedback-warn-bg)",
              border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 25%, transparent)",
            }}
          >
            <AlertTriangle
              className="h-4 w-4 mt-0.5 shrink-0"
              aria-hidden="true"
              style={{ color: "var(--feedback-warn-fg)" }}
            />
            <div className="flex flex-col gap-1">
              <p
                className="text-[13px] font-semibold"
                style={{ color: "var(--feedback-warn-fg)" }}
              >
                Runs will lose their environment reference
              </p>
              <p
                className="text-xs leading-relaxed"
                style={{ color: "var(--feedback-warn-fg)" }}
              >
                Any existing runs that referenced{" "}
                <strong>{environment?.name ?? "this environment"}</strong>{" "}
                will have their environment field set to null. The runs
                themselves are not deleted, but the environment association
                is permanently lost and cannot be restored.
              </p>
            </div>
          </div>

          {/* Confirmation message */}
          <p
            className="text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            Are you sure you want to permanently delete{" "}
            <span
              className="font-semibold font-mono px-1 py-0.5 rounded text-xs"
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--fg-default)",
                border: "1px solid var(--border-default)",
              }}
            >
              {environment?.name ?? ""}
            </span>
            ? This action cannot be undone.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => { if (environment) onConfirm(environment); }}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? "Deleting…" : "Delete environment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
