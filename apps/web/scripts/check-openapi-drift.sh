#!/usr/bin/env bash
# check-openapi-drift.sh
#
# Regenerates OpenAPI TypeScript types and snapshot from a running API server,
# then diffs them against the committed files.
#
# Fails the build if either file has drifted.
#
# Usage:
#   VITE_API_BASE_URL=http://localhost:8000 bash apps/web/scripts/check-openapi-drift.sh
#
# Called by CI after the API server is booted.

set -euo pipefail

API_URL="${VITE_API_BASE_URL:-http://localhost:8000}"
SCHEMA_TS="apps/web/src/lib/api/schema.d.ts"
SNAPSHOT_JSON="apps/web/openapi.snapshot.json"

echo "==> Checking OpenAPI schema drift against ${API_URL}"

# ── 1. Regenerate schema.d.ts ──────────────────────────────────────────────
tmp_ts=$(mktemp --suffix=.d.ts)
echo "    Regenerating ${SCHEMA_TS}…"

pnpm --filter web exec openapi-typescript "${API_URL}/openapi.json" -o "${tmp_ts}"

if ! diff -q "${SCHEMA_TS}" "${tmp_ts}" > /dev/null 2>&1; then
  echo ""
  echo "ERROR: OpenAPI schema drift detected in schema.d.ts"
  echo "       Regenerate with: pnpm --filter web openapi:gen"
  echo "       Then commit the updated file."
  echo ""
  diff -u "${SCHEMA_TS}" "${tmp_ts}" || true
  rm -f "${tmp_ts}"
  exit 1
fi

rm -f "${tmp_ts}"
echo "    schema.d.ts is up to date."

# ── 2. Regenerate openapi.snapshot.json ───────────────────────────────────
tmp_json=$(mktemp --suffix=.json)
echo "    Regenerating ${SNAPSHOT_JSON}…"

curl -sf "${API_URL}/openapi.json" -o "${tmp_json}"

if ! diff -q "${SNAPSHOT_JSON}" "${tmp_json}" > /dev/null 2>&1; then
  echo ""
  echo "ERROR: OpenAPI snapshot drift detected in openapi.snapshot.json"
  echo "       Update with: curl ${API_URL}/openapi.json > apps/web/openapi.snapshot.json"
  echo "       Then commit the updated snapshot."
  echo ""
  diff -u "${SNAPSHOT_JSON}" "${tmp_json}" || true
  rm -f "${tmp_json}"
  exit 1
fi

rm -f "${tmp_json}"
echo "    openapi.snapshot.json is up to date."

echo ""
echo "==> OpenAPI schema in sync. No drift detected."
