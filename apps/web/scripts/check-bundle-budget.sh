#!/usr/bin/env bash
# check-bundle-budget.sh
#
# Verifies that no individual JS chunk exceeds the gzip budget.
# For a lazy-loaded SPA, each route's chunk is loaded independently,
# so the relevant metric is the size of the largest chunk.
#
# Thresholds (SP3.2 targets, per-chunk):
#   Warning:  250 KB gzipped — prompts investigation but does not fail CI.
#   Hard gate: 350 KB gzipped — fails CI (exits non-zero).
#
# Reads the Vite build output from apps/web/dist/assets/.
# Checks gzip size of all .js files in dist/assets.

set -euo pipefail

DIST_DIR="apps/web/dist/assets"
WARNING_KB=250
BUDGET_KB=350

echo "==> Bundle budget check (per-chunk warning: ${WARNING_KB} KB | hard gate: ${BUDGET_KB} KB gzipped)"

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "ERROR: ${DIST_DIR} does not exist. Run 'pnpm --filter web build' first."
  exit 1
fi

# Track the largest chunk
max_bytes=0
max_file=""
total_bytes=0
file_count=0
failed=0

while IFS= read -r -d '' js_file; do
  gz_size=$(gzip -c "${js_file}" | wc -c | tr -d ' ')
  total_bytes=$((total_bytes + gz_size))
  file_count=$((file_count + 1))
  kb=$(echo "scale=1; ${gz_size} / 1024" | bc)
  kb_int=$(echo "${gz_size} / 1024" | bc)

  status=""
  if [[ ${kb_int} -gt ${BUDGET_KB} ]]; then
    status=" [EXCEEDS HARD GATE]"
    failed=1
  elif [[ ${kb_int} -gt ${WARNING_KB} ]]; then
    status=" [WARNING > ${WARNING_KB} KB]"
  fi

  echo "    $(basename "${js_file}"): ${kb} KB gzip${status}"

  if [[ ${gz_size} -gt ${max_bytes} ]]; then
    max_bytes=${gz_size}
    max_file=$(basename "${js_file}")
  fi
done < <(find "${DIST_DIR}" -name "*.js" -print0)

total_kb=$(echo "scale=1; ${total_bytes} / 1024" | bc)
max_kb=$(echo "scale=1; ${max_bytes} / 1024" | bc)
max_kb_int=$(echo "${max_bytes} / 1024" | bc)

echo ""
echo "    Largest chunk: ${max_file} — ${max_kb} KB gzip"
echo "    Total all chunks: ${total_kb} KB gzip (${file_count} JS files)"

# Hard gate: fail if any single chunk exceeds 350 KB
if [[ ${failed} -eq 1 ]]; then
  echo ""
  echo "ERROR: One or more chunks exceed the hard gate of ${BUDGET_KB} KB gzipped."
  echo "       Run 'pnpm --filter web build' and inspect chunk sizes."
  exit 1
fi

# Warning: emit a note if the largest chunk is between 250 KB and 350 KB
if [[ ${max_kb_int} -gt ${WARNING_KB} ]]; then
  echo ""
  echo "WARNING: Largest chunk (${max_file}) exceeds ${WARNING_KB} KB (${max_kb} KB gzip)."
  echo "         Consider code-splitting or lazy-loading to stay below the ${WARNING_KB} KB target."
  echo "         CI will not fail — this is a warning only."
fi

echo ""
echo "==> All chunks within hard gate (${BUDGET_KB} KB). Largest: ${max_kb} KB (${max_file})"
