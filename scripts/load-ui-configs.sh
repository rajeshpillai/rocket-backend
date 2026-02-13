#!/usr/bin/env bash
#
# Load UI configs from a JSON file into a Rocket app.
#
# Usage:
#   ./scripts/load-ui-configs.sh <app-name> <config-file> [base-url]
#
# Examples:
#   ./scripts/load-ui-configs.sh cms examples/frontend/ui-configs-cms.json
#   ./scripts/load-ui-configs.sh helpdesk examples/frontend/ui-configs-helpdesk.json
#   ./scripts/load-ui-configs.sh cms examples/frontend/ui-configs-cms.json http://localhost:9090
#

set -euo pipefail

APP="${1:?Usage: $0 <app-name> <config-file> [base-url]}"
CONFIG_FILE="${2:?Usage: $0 <app-name> <config-file> [base-url]}"
BASE_URL="${3:-http://localhost:8080}"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  exit 1
fi

# Get platform token
echo "Authenticating with platform..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/_platform/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"platform@localhost","password":"changeme"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.access_token // empty')
if [ -z "$TOKEN" ]; then
  echo "Error: Failed to authenticate. Response:"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "Authenticated. Loading UI configs for app '$APP' from $CONFIG_FILE..."
echo ""

COUNT=$(jq length "$CONFIG_FILE")
CREATED=0
FAILED=0
SKIPPED=0

for i in $(seq 0 $(($COUNT - 1))); do
  ENTITY=$(jq -r ".[$i].entity" "$CONFIG_FILE")
  PAYLOAD=$(jq -c ".[$i]" "$CONFIG_FILE")

  RESULT=$(curl -s -X POST "$BASE_URL/api/$APP/_admin/ui-configs" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

  ID=$(echo "$RESULT" | jq -r '.data.id // empty')
  ERR=$(echo "$RESULT" | jq -r '.error.message // empty')

  if [ -n "$ID" ]; then
    echo "  + $ENTITY: created ($ID)"
    CREATED=$((CREATED + 1))
  elif echo "$ERR" | grep -qi "unique\|already\|conflict\|duplicate"; then
    echo "  ~ $ENTITY: skipped (already exists)"
    SKIPPED=$((SKIPPED + 1))
  else
    echo "  x $ENTITY: FAILED - $ERR"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "Done: $CREATED created, $SKIPPED skipped, $FAILED failed (out of $COUNT)"
