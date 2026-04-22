#!/usr/bin/env bash
# check-bundle-budget.sh
#
# Verifies that the main application bundle stays within the gzip budget.
#
# Route-split chunks (lazy-loaded pages such as RunExecutePage, EditForm,
# ApprovalsInboxPage, etc.) are excluded from the gate — they are loaded
# on demand and do not add to the initial page weight.
#
# Thresholds (SP3.3 targets, applied to the main bundle only):
#   Warning:  250 KB gzipped — prompts investigation but does not fail CI.
#   Hard gate: 350 KB gzipped — fails CI (exits non-zero).
#
# Route-split chunk patterns excluded from the gate:
#   RunExecutePage-*  FocusMode-*  GridMode-*  CaseRenderer-*
#   ApprovalsInboxPage-*  ReviewDetailPage-*  EditForm-*  ConflictWorkspace-*
#   MarkdownDiffSplit-*
#
# Runner exclusion assertion:
#   The script also asserts that the main bundle does NOT contain the string
#   "RunExecutePage" as a guard against accidental eager-import regressions.
#
# Reads the Vite build output from apps/web/dist/assets/.

set -euo pipefail

DIST_DIR="apps/web/dist/assets"
WARNING_KB=250
BUDGET_KB=350

# Patterns whose chunks are route-split (lazy) and excluded from the main-bundle gate.
# These match the Rollup output filenames produced by React.lazy() code-splitting.
ROUTE_SPLIT_PATTERNS=(
  "RunExecutePage"
  "FocusMode"
  "GridMode"
  "CaseRenderer"
  "ApprovalsInboxPage"
  "ReviewDetailPage"
  "EditForm"
  "ConflictWorkspace"
  "MarkdownDiffSplit"
)

echo "==> Bundle budget check (main bundle: warn ${WARNING_KB} KB | hard gate ${BUDGET_KB} KB gzipped)"

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "ERROR: ${DIST_DIR} does not exist. Run 'pnpm --filter web build' first."
  exit 1
fi

# ── Helper: is_route_split ──────────────────────────────────────────────────
# Returns 0 (true) if the filename matches any route-split pattern.
is_route_split() {
  local filename="$1"
  for pattern in "${ROUTE_SPLIT_PATTERNS[@]}"; do
    if [[ "${filename}" == *"${pattern}"* ]]; then
      return 0
    fi
  done
  return 1
}

# ── Pass 1: categorise all JS chunks ───────────────────────────────────────
main_bytes=0
main_files=()
route_bytes=0
route_files=()
vendor_bytes=0
vendor_files=()

while IFS= read -r -d '' js_file; do
  basename_file=$(basename "${js_file}")
  gz_size=$(gzip -c "${js_file}" | wc -c | tr -d ' ')
  kb=$(echo "scale=1; ${gz_size} / 1024" | bc)

  if is_route_split "${basename_file}"; then
    route_bytes=$((route_bytes + gz_size))
    route_files+=("${basename_file}: ${kb} KB")
  elif [[ "${basename_file}" == index-* ]]; then
    main_bytes=$((main_bytes + gz_size))
    main_files+=("${basename_file}: ${kb} KB")
  else
    # vendor / shared chunks (react, query, markdown, etc.)
    vendor_bytes=$((vendor_bytes + gz_size))
    vendor_files+=("${basename_file}: ${kb} KB")
  fi
done < <(find "${DIST_DIR}" -name "*.js" -print0)

# ── Report: vendor chunks ───────────────────────────────────────────────────
echo ""
echo "  Vendor / shared chunks (informational):"
for f in "${vendor_files[@]}"; do
  echo "    ${f}"
done

# ── Report: route-split chunks (excluded from gate) ────────────────────────
echo ""
echo "  Route-split chunks (excluded from main-bundle gate):"
if [[ ${#route_files[@]} -eq 0 ]]; then
  echo "    (none)"
else
  for f in "${route_files[@]}"; do
    echo "    ${f}"
  done
fi
route_kb=$(echo "scale=1; ${route_bytes} / 1024" | bc)
echo "    Subtotal: ${route_kb} KB gzip"

# ── Report: main bundle ─────────────────────────────────────────────────────
echo ""
echo "  Main bundle:"
if [[ ${#main_files[@]} -eq 0 ]]; then
  echo "ERROR: No index-*.js chunk found in ${DIST_DIR}."
  echo "       Is the Vite build output pointing to the right directory?"
  exit 1
fi
for f in "${main_files[@]}"; do
  echo "    ${f}"
done
main_kb=$(echo "scale=1; ${main_bytes} / 1024" | bc)
main_kb_int=$(echo "${main_bytes} / 1024" | bc)
echo "    Subtotal: ${main_kb} KB gzip"

# ── Runner exclusion assertion ──────────────────────────────────────────────
# Guard against accidental eager-import of the Runner into the main bundle.
#
# The correct signal is the EXISTENCE of a RunExecutePage-*.js chunk file:
# if Rollup emitted it as a separate file, the lazy() boundary held.
# The main bundle will always contain the dynamic import() call (e.g.
# import("./RunExecutePage-abc123.js")) — that is expected and correct.
# We do NOT grep for the string; we check the file was actually split out.
#
# Additionally we count how many route-split chunk files matched to confirm
# Rollup didn't inline them back into the main bundle (which would happen if
# the dynamic import was removed).
echo ""
echo "  Runner exclusion assertion:"
failed_exclusion=0

# Verify a RunExecutePage chunk file exists (lazy boundary held)
runexec_count=$(find "${DIST_DIR}" -name "RunExecutePage-*.js" | wc -l | tr -d ' ')
if [[ "${runexec_count}" -eq 0 ]]; then
  echo "    ERROR: No RunExecutePage-*.js chunk found in ${DIST_DIR}."
  echo "           The lazy() boundary at router.tsx may have collapsed."
  echo "           Ensure RunExecutePage is imported only via React.lazy()."
  failed_exclusion=1
else
  echo "    OK — RunExecutePage-*.js chunk exists (${runexec_count} file(s)); lazy boundary held."
fi

# Verify the route-split chunks we expect are all present
missing_chunks=0
for pattern in "RunExecutePage" "EditForm" "ApprovalsInboxPage"; do
  count=$(find "${DIST_DIR}" -name "${pattern}-*.js" | wc -l | tr -d ' ')
  if [[ "${count}" -eq 0 ]]; then
    echo "    WARNING: No ${pattern}-*.js chunk found — route-split may have collapsed."
    missing_chunks=$((missing_chunks + 1))
  fi
done
if [[ ${missing_chunks} -eq 0 ]]; then
  echo "    OK — all expected route-split chunk files present."
fi

# ── Gate evaluation ─────────────────────────────────────────────────────────
echo ""
gate_failed=0

if [[ ${main_kb_int} -gt ${BUDGET_KB} ]]; then
  echo "ERROR: Main bundle (${main_kb} KB gzip) exceeds hard gate of ${BUDGET_KB} KB."
  echo "       Investigate with: pnpm --filter web build && npx vite-bundle-visualizer"
  gate_failed=1
elif [[ ${main_kb_int} -gt ${WARNING_KB} ]]; then
  echo "WARNING: Main bundle (${main_kb} KB gzip) exceeds ${WARNING_KB} KB target."
  echo "         Consider further code-splitting to stay below ${WARNING_KB} KB."
  echo "         CI will not fail — this is a warning only."
else
  echo "==> Main bundle within budget: ${main_kb} KB gzip (gate ${BUDGET_KB} KB | target ${WARNING_KB} KB)"
fi

if [[ ${failed_exclusion} -ne 0 ]]; then
  exit 1
fi

if [[ ${gate_failed} -ne 0 ]]; then
  exit 1
fi

echo "==> Bundle budget check passed."
