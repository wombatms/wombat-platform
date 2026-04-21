#!/usr/bin/env bash
# check-bundle-budget.sh
#
# Verifies that the initial JS bundle is within the 350 KB gzip budget
# specified in spec §11.6 and enforced by CI (Task 49).
#
# Reads the Vite build output from apps/web/dist/assets/.
# Sums the gzip size of all .js files that are not lazy-loaded chunks
# (i.e. files that are referenced from the main index.html entry point).
#
# Approach: Vite outputs gzip sizes in its build log, but we also
# measure directly using gzip to be reliable in CI.

set -euo pipefail

DIST_DIR="apps/web/dist/assets"
BUDGET_KB=350

echo "==> Bundle budget check (budget: ${BUDGET_KB} KB gzipped)"

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "ERROR: ${DIST_DIR} does not exist. Run 'pnpm --filter web build' first."
  exit 1
fi

# Sum gzip sizes of all .js files in dist/assets
total_bytes=0
file_count=0

while IFS= read -r -d '' js_file; do
  gz_size=$(gzip -c "${js_file}" | wc -c | tr -d ' ')
  total_bytes=$((total_bytes + gz_size))
  file_count=$((file_count + 1))
  kb=$(echo "scale=1; ${gz_size} / 1024" | bc)
  echo "    $(basename "${js_file}"): ${kb} KB gzip"
done < <(find "${DIST_DIR}" -name "*.js" -print0)

total_kb=$(echo "scale=1; ${total_bytes} / 1024" | bc)
total_kb_int=$(echo "${total_bytes} / 1024" | bc)

echo ""
echo "    Total: ${total_kb} KB gzip (${file_count} JS files)"

if [[ ${total_kb_int} -gt ${BUDGET_KB} ]]; then
  echo ""
  echo "ERROR: Bundle exceeds ${BUDGET_KB} KB budget (actual: ${total_kb} KB)."
  echo "       Run 'pnpm --filter web build' and inspect the bundle visualizer artifact."
  exit 1
fi

echo ""
echo "==> Bundle within budget: ${total_kb} KB / ${BUDGET_KB} KB"
