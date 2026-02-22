#!/usr/bin/env bash
# Run the built MCP server standalone
set -euo pipefail

export ROCKET_URL="${ROCKET_URL:-http://localhost:8080}"
export ROCKET_EMAIL="${ROCKET_EMAIL:-platform@localhost}"
export ROCKET_PASSWORD="${ROCKET_PASSWORD:-changeme}"

exec node "$(dirname "$0")/dist/index.js"
