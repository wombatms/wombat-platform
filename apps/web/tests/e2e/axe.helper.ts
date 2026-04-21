/**
 * axe-core accessibility helper for Playwright E2E specs.
 *
 * Gates: serious and critical violations only.
 * Moderate and minor violations are logged as warnings but do not fail the test.
 * This matches spec §11.3 ("assert zero serious/critical violations on every
 * page of the smoke suite").
 *
 * Usage:
 *   import { axeScan } from "./axe.helper";
 *   await axeScan(page);
 */

import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export interface AxeScanOptions {
  /** Additional CSS selectors to exclude from scanning. */
  exclude?: string[];
  /** Override rules. */
  rules?: Record<string, { enabled: boolean }>;
}

export async function axeScan(page: Page, opts: AxeScanOptions = {}): Promise<void> {
  const builder = new AxeBuilder({ page }).options({
    rules: {
      // Color contrast is often noisy with custom tokens + jsdom.
      // We keep it enabled but only fail on serious/critical.
      "color-contrast": { enabled: true },
      ...opts.rules,
    },
  });

  if (opts.exclude) {
    for (const sel of opts.exclude) {
      builder.exclude(sel);
    }
  }

  const result = await builder.analyze();

  // Separate serious/critical violations from moderate/minor
  const blocking = result.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  const informational = result.violations.filter(
    (v) => v.impact !== "serious" && v.impact !== "critical",
  );

  if (informational.length > 0) {
    console.warn(
      `[axe] ${informational.length} informational violation(s) (not blocking):`,
      informational.map((v) => `${v.id} (${v.impact}): ${v.description}`).join("\n  "),
    );
  }

  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => {
        const nodes = v.nodes.slice(0, 2).map((n) => n.html).join("\n    ");
        return `\n  [${v.impact}] ${v.id}: ${v.description}\n    ${nodes}`;
      })
      .join("");

    throw new Error(
      `axe-core found ${blocking.length} serious/critical violation(s):${summary}`,
    );
  }
}
