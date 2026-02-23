#!/usr/bin/env bash
set -euo pipefail

# ── Holms Installer ──────────────────────────────────────────────────
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/matthias-trip/holms/main/install.sh | bash
#   curl -fsSL ... | bash -s -- --no-auto-update
#   HOLMS_DIR=/opt/holms HOLMS_PORT=8080 bash install.sh

HOLMS_IMAGE="ghcr.io/matthias-trip/holms:latest"
HOLMS_DIR="${HOLMS_DIR:-$HOME/.holms}"
HOLMS_PORT="${HOLMS_PORT:-3100}"
AUTO_UPDATE=true

for arg in "$@"; do
  case "$arg" in
    --no-auto-update) AUTO_UPDATE=false ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────

info()  { echo -e "\033[1;34m==>\033[0m $*"; }
ok()    { echo -e "\033[1;32m✓\033[0m $*"; }
warn()  { echo -e "\033[1;33m!\033[0m $*"; }
fail()  { echo -e "\033[1;31m✗\033[0m $*"; exit 1; }

check_command() {
  command -v "$1" >/dev/null 2>&1
}

# ── OS Detection ─────────────────────────────────────────────────────

OS="$(uname -s)"
case "$OS" in
  Linux)  OS_NAME="Linux" ;;
  Darwin) OS_NAME="macOS" ;;
  *)      fail "Unsupported OS: $OS. Holms supports Linux and macOS." ;;
esac

info "Detected $OS_NAME"

# ── Docker Check ─────────────────────────────────────────────────────

if ! check_command docker; then
  fail "Docker is not installed. Please install Docker first:
  $OS_NAME: https://docs.docker.com/get-docker/"
fi

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not running. Please start Docker and try again."
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose is not available. Please install Docker Compose:
  https://docs.docker.com/compose/install/"
fi

ok "Docker and Docker Compose are available"

# ── Claude CLI Check ─────────────────────────────────────────────────

if [ ! -d "$HOME/.claude" ]; then
  warn "Claude CLI config not found (~/.claude)"
  info "Installing Claude CLI..."

  if check_command claude; then
    ok "Claude CLI already installed"
  else
    curl -fsSL https://claude.ai/install.sh | bash
    ok "Claude CLI installed"
  fi

  echo ""
  info "Please run 'claude' to authenticate, then re-run this installer."
  echo "  claude"
  echo ""
  exit 0
fi

ok "Claude CLI config found (~/.claude)"

# ── Create Install Directory ─────────────────────────────────────────

info "Installing Holms to $HOLMS_DIR"
mkdir -p "$HOLMS_DIR"/{data,models,plugins}

# ── Generate docker-compose.yml ──────────────────────────────────────

COMPOSE_FILE="$HOLMS_DIR/docker-compose.yml"

cat > "$COMPOSE_FILE" <<YAML
services:
  holms:
    image: ${HOLMS_IMAGE}
    container_name: holms
    ports:
      - "${HOLMS_PORT}:3100"
    volumes:
      - ./data:/data
      - ./models:/models
      - ./plugins:/plugins
      - ${HOME}/.claude:/root/.claude:ro
    environment:
      - HOLMS_PORT=3100
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3100/trpc').catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
YAML

if [ "$AUTO_UPDATE" = true ]; then
  cat >> "$COMPOSE_FILE" <<'YAML'

  watchtower:
    image: containrrr/watchtower
    container_name: holms-watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      DOCKER_API_VERSION: "1.44"
      WATCHTOWER_CLEANUP: "true"
      WATCHTOWER_SCHEDULE: "0 0 3 * * *"
      WATCHTOWER_INCLUDE_STOPPED: "true"
    restart: unless-stopped
YAML
  ok "Auto-updates enabled (Watchtower, daily at 3 AM)"
else
  ok "Auto-updates disabled"
fi

# ── Pull & Start ─────────────────────────────────────────────────────

info "Pulling latest image..."
docker compose -f "$COMPOSE_FILE" pull

info "Starting Holms..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
ok "Holms is running!"
echo ""
echo "  Dashboard:  http://localhost:${HOLMS_PORT}"
echo "  Install:    ${HOLMS_DIR}"
echo "  Logs:       docker compose -f ${COMPOSE_FILE} logs -f"
echo "  Stop:       docker compose -f ${COMPOSE_FILE} down"
echo ""
