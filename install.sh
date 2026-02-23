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

# ── Create Install Directory ─────────────────────────────────────────

info "Installing Holms to $HOLMS_DIR"
mkdir -p "$HOLMS_DIR"/{data,models,plugins}

# ── Authentication Setup ─────────────────────────────────────────────

ENV_FILE="$HOLMS_DIR/.env"

if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  # Token provided via environment variable
  echo "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}" > "$ENV_FILE"
  ok "Using provided OAuth token"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  # API key provided via environment variable
  echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" > "$ENV_FILE"
  ok "Using provided API key"
elif [ -f "$ENV_FILE" ] && grep -q "CLAUDE_CODE_OAUTH_TOKEN\|ANTHROPIC_API_KEY" "$ENV_FILE" 2>/dev/null; then
  # Existing .env with credentials
  ok "Using existing credentials from $ENV_FILE"
else
  # Need to generate a token
  info "Holms needs authentication to use Claude."
  echo ""

  if check_command claude; then
    info "Generating a long-lived OAuth token via Claude CLI..."
    echo "  This will open your browser for authentication."
    echo ""

    TOKEN=$(claude setup-token 2>/dev/null) || true

    if [ -n "$TOKEN" ]; then
      echo "CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}" > "$ENV_FILE"
      ok "OAuth token saved"
    else
      warn "Could not generate token automatically."
      echo ""
      echo "  Please set your credentials in: $ENV_FILE"
      echo ""
      echo "  Option A — Claude subscription (run 'claude setup-token' and paste the result):"
      echo "    CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-..."
      echo ""
      echo "  Option B — API key (from console.anthropic.com):"
      echo "    ANTHROPIC_API_KEY=sk-ant-api03-..."
      echo ""
      # Create empty .env so compose doesn't complain
      touch "$ENV_FILE"
    fi
  else
    warn "Claude CLI not found. Please set your credentials in: $ENV_FILE"
    echo ""
    echo "  Option A — Install Claude CLI and generate an OAuth token:"
    echo "    curl -fsSL https://claude.ai/install.sh | bash"
    echo "    claude setup-token"
    echo "    Then add to $ENV_FILE:"
    echo "      CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-..."
    echo ""
    echo "  Option B — Use an API key (from console.anthropic.com):"
    echo "    Add to $ENV_FILE:"
    echo "      ANTHROPIC_API_KEY=sk-ant-api03-..."
    echo ""
    # Create empty .env so compose doesn't complain
    touch "$ENV_FILE"
  fi
fi

chmod 600 "$ENV_FILE"

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
    env_file:
      - path: .env
        required: false
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
echo "  Config:     ${ENV_FILE}"
echo "  Logs:       docker compose -f ${COMPOSE_FILE} logs -f"
echo "  Stop:       docker compose -f ${COMPOSE_FILE} down"
echo ""
