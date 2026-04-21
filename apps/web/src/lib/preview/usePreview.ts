import { useCallback, useEffect, useState } from "react";

function storageKey(kind: string) {
  return `wombat.preview.${kind}`;
}

function readPreview(kind: string): boolean {
  try {
    return localStorage.getItem(storageKey(kind)) === "true";
  } catch { return false; }
}

/**
 * usePreview — persisted per-kind preview-pane toggle.
 *
 * Returns [previewOpen, setPreviewOpen, togglePreview].
 * The `p` keyboard shortcut should be wired in the consumer page so that
 * it only fires when that page is mounted.
 */
export function usePreview(kind: string): [boolean, (v: boolean) => void, () => void] {
  const [open, setOpenState] = useState<boolean>(() => readPreview(kind));

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try { localStorage.setItem(storageKey(kind), String(next)); } catch { /* */ }
  }, [kind]);

  const toggle = useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  // Sync across tabs
  useEffect(() => {
    const key = storageKey(kind);
    const handler = (e: StorageEvent) => {
      if (e.key === key) {
        setOpenState(e.newValue === "true");
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [kind]);

  return [open, setOpen, toggle];
}
