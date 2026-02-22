#!/usr/bin/env bash
# Run the MCP server with the MCP Inspector (interactive browser UI)
set -euo pipefail

export ROCKET_URL="${ROCKET_URL:-http://localhost:8080}"
export ROCKET_EMAIL="${ROCKET_EMAIL:-platform@localhost}"
export ROCKET_PASSWORD="${ROCKET_PASSWORD:-changeme}"

# Build first to ensure dist/ is up to date
npm run --prefix "$(dirname "$0")" build

exec npx @modelcontextprotocol/inspector node "$(dirname "$0")/dist/index.js"
