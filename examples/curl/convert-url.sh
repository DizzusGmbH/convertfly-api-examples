#!/usr/bin/env bash
# Convert a file that is already online (import/url), with curl and jq.
#
# Usage:
#   export CONVERTFLY_API_KEY=cvfly_sk_...
#   ./convert-url.sh https://example.com/photo.png pdf
set -euo pipefail
API=https://convertfly.io/api/v1
URL=$1
FORMAT=$2
AUTH="Authorization: Bearer $CONVERTFLY_API_KEY"

JOB=$(curl -sf -X POST "$API/jobs" -H "$AUTH" -H 'Content-Type: application/json' -d @- <<JSON | jq -r .id
{"tasks": {
  "import": {"operation": "import/url", "url": "$URL"},
  "convert": {"operation": "convert", "input": "import", "output_format": "$FORMAT"},
  "export": {"operation": "export/url", "input": "convert"}
}}
JSON
)
echo "job $JOB"

while :; do
  STATE=$(curl -sf "$API/jobs/$JOB" -H "$AUTH")
  STATUS=$(jq -r '.status | ascii_downcase' <<<"$STATE")
  [ "$STATUS" = finished ] && break
  FAILED=$(jq -r '[.tasks[]? // empty | select((.status // "" | ascii_downcase) == "error") | "\(.name): \(.error // .code)"] | first // empty' <<<"$STATE")
  if [ "$STATUS" = error ] || [ -n "$FAILED" ]; then echo "job failed: ${FAILED:-unknown error}" >&2; exit 1; fi
  sleep 1
done

jq -r '(.tasks | if type == "array" then map({(.name): .}) | add else . end).export.result.files[0].url' <<<"$STATE"
