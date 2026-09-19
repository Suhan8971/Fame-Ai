#!/usr/bin/env bash
# Share Fashion-Show with someone else through a free, temporary public link.
#
# Runs everything on THIS Mac and exposes it with a Cloudflare quick tunnel
# (no account needed):
#   backend  (python3 backend/app.py)          -> 127.0.0.1:5050
#   frontend (production build, vite preview)  -> 127.0.0.1:4173, proxies the backend
#   tunnel   (cloudflared)                      -> https://<random>.trycloudflare.com
#
# Run it from Terminal (which needs Camera access for scans):
#   ./share.sh
# Keep the window open while your friend tests; Ctrl+C stops everything.
# The link changes every time you run this.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/logs"
TOOLS="$ROOT/tools"
FRONTEND_PORT=4173
BACKEND_URL="http://127.0.0.1:5050"
mkdir -p "$LOGS" "$TOOLS"

PIDS=()
cleanup() {
  echo
  echo "Stopping share..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -INT "$pid" 2>/dev/null || true
  done
  # Give the backend time to shut down its try-on worker process itself
  for _ in $(seq 1 15); do
    alive=0
    for pid in "${PIDS[@]:-}"; do
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" = 0 ] && break
    sleep 1
  done
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_for() { # url, seconds, name
  for _ in $(seq 1 "$2"); do
    curl -s -o /dev/null -m 2 "$1" && return 0
    sleep 1
  done
  echo "ERROR: $3 did not start. See $LOGS/" >&2
  exit 1
}

# --- cloudflared (official Cloudflare release) --------------------------------
CLOUDFLARED="$(command -v cloudflared || true)"
if [ -z "$CLOUDFLARED" ]; then
  CLOUDFLARED="$TOOLS/cloudflared"
  if [ ! -x "$CLOUDFLARED" ]; then
    case "$(uname -m)" in
      arm64) ARCH=arm64 ;;
      *) ARCH=amd64 ;;
    esac
    echo "Downloading cloudflared (Cloudflare's official tunnel client)..."
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" \
      | tar -xz -C "$TOOLS"
    chmod +x "$CLOUDFLARED"
  fi
fi

# --- backend ------------------------------------------------------------------
if curl -s -m 2 "$BACKEND_URL/" | grep -q "body scanner"; then
  echo "Backend already running on $BACKEND_URL - reusing it."
else
  echo "Starting backend (first start can take a minute)..."
  (cd "$ROOT/backend" && exec python3 app.py) > "$LOGS/backend.log" 2>&1 &
  PIDS+=($!)
  wait_for "$BACKEND_URL/" 180 "Backend"
fi

# --- frontend -----------------------------------------------------------------
cd "$ROOT/frontend"
[ -d node_modules ] || npm install
echo "Building frontend..."
npm run build > "$LOGS/frontend-build.log" 2>&1 || { echo "ERROR: frontend build failed, see $LOGS/frontend-build.log" >&2; exit 1; }
npx vite preview --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort > "$LOGS/frontend.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$FRONTEND_PORT/" 60 "Frontend"

# --- tunnel -------------------------------------------------------------------
echo "Opening public link..."
: > "$LOGS/tunnel.log"
"$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$FRONTEND_PORT" > "$LOGS/tunnel.log" 2>&1 &
PIDS+=($!)
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "ERROR: could not open the tunnel, see $LOGS/tunnel.log" >&2; exit 1; }

# Keep the Mac awake while sharing
caffeinate -dims -w $$ &
PIDS+=($!)

cat <<EOF

==============================================================
  Share this link with your friend:

      $URL

  Local:  http://127.0.0.1:$FRONTEND_PORT
  Logs:   $LOGS/
  Press Ctrl+C to stop sharing.
==============================================================
  Heads-up:
  - Body scans use THIS Mac's webcam; anyone with the link can
    turn it on and see its live feed.
  - Virtual try-ons from the link use your OpenAI API key.
==============================================================
EOF

wait
