#!/bin/sh
set -eu
APP_PORT="${PORT:-8787}"
export VLR_LOCAL_API="${VLR_LOCAL_API:-http://127.0.0.1:3002/api}"
export DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
(
  cd /opt/vlr-api
  PORT=3002 node dist/index.js
) &
VLR_PID=$!
trap 'kill $VLR_PID 2>/dev/null || true' EXIT INT TERM
# Wait briefly for local metadata API.
i=0
while [ $i -lt 30 ]; do
  if node -e "fetch('http://127.0.0.1:3002/api/matches/upcoming').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
  i=$((i+1)); sleep 1
done
PORT="$APP_PORT" node /app/server.js
