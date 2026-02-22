#!/usr/bin/env bash
# Run the MCP server in dev mode (no build step, uses tsx)
set -euo pipefail

export ROCKET_URL="${ROCKET_URL:-http://localhost:8080}"
export ROCKET_EMAIL="${ROCKET_EMAIL:-platform@localhost}"
export ROCKET_PASSWORD="${ROCKET_PASSWORD:-changeme}"

exec npx tsx "$(dirname "$0")/src/index.ts"
