#!/usr/bin/env bash
# Convert a file that is already online (import/url), with curl and jq.
#
# Usage:
#   export CONVERTFLY_API_KEY=cvfly_sk_...
#   ./convert-url.sh https://example.com/photo.png pdf
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <file_url> <output_format>" >&2; exit 1; }
: "${CONVERTFLY_API_KEY:?set CONVERTFLY_API_KEY first}"

API=https://convertfly.io/api/v1
AUTH="Authorization: Bearer $CONVERTFLY_API_KEY"

# curl, with the API error message printed when the request fails.
api() {
  local body
  body=$(curl -sS --fail-with-body "$@") || { echo "$body" >&2; return 1; }
  printf "%s" "$body"
}

# jq builds the request body, so a URL with quotes or backslashes stays valid JSON.
JOB=$(jq -n --arg url "$1" --arg format "$2" '{tasks: {
  import:  {operation: "import/url", url: $url},
  convert: {operation: "convert", input: "import", output_format: $format},
  export:  {operation: "export/url", input: "convert"}
}}' | api -X POST "$API/jobs" -H "$AUTH" -H 'Content-Type: application/json' -d @- | jq -er .id)
echo "job $JOB" >&2

# /wait answers 200 once the job is finished, 202 after about 30 s: ask again until 200.
while :; do
  STATE=$(api -w '\n%{http_code}' "$API/jobs/$JOB/wait" -H "$AUTH")
  [ "${STATE##*$'\n'}" = 200 ] && break
done
STATE=${STATE%$'\n'*}

if [ "$(jq -r .status <<<"$STATE")" != finished ]; then
  # The task that failed first; the ones it blocked say DEPENDENCY_FAILED.
  echo "job failed: $(jq -r '[.tasks[] | select(.status == "error")] | sort_by(.code == "DEPENDENCY_FAILED") | first | if . then "\(.name): \(.error // .code)" else "unknown error" end' <<<"$STATE")" >&2
  exit 1
fi

jq -r '.tasks[] | select(.name == "export") | .result.files[0].url' <<<"$STATE"
