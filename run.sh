#!/usr/bin/env bash
# Month-End Close Agent — regenerates synthetic data and launches the offline demo.
# No network access, no external services. Safe to run repeatedly.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8420}"
URL="http://localhost:${PORT}/"

echo "Generating synthetic reconciliation data..."
python3 generate_data.py

echo ""
echo "Starting local server at ${URL}"
echo "Press Ctrl+C to stop."
echo ""

if command -v open >/dev/null 2>&1; then
  ( sleep 1 && open -a "Google Chrome" "${URL}" ) &
fi

cd web
exec python3 -m http.server "${PORT}"
