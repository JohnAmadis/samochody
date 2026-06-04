#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
elif docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
else
  echo "Brak docker-compose / docker compose" >&2
  exit 1
fi

PROJECT_NAME="$(basename "$ROOT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')"
APP_PORT="${APP_PORT:-18080}"

export APP_PORT

echo "[1/4] Start bazy danych..."
"${COMPOSE_CMD[@]}" up -d db

echo "[2/4] Budowa obrazu aplikacji..."
"${COMPOSE_CMD[@]}" build app

echo "[3/4] Usuwanie starego kontenera app (obejście błędu ContainerConfig)..."
APP_CONTAINER_IDS="$(docker ps -aq \
  --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
  --filter "label=com.docker.compose.service=app")"
if [[ -n "$APP_CONTAINER_IDS" ]]; then
  docker rm -f $APP_CONTAINER_IDS >/dev/null
fi

echo "[4/4] Uruchamianie aplikacji..."
"${COMPOSE_CMD[@]}" up -d --no-deps app

printf '\nAplikacja powinna być dostępna pod: http://localhost:%s\n' "$APP_PORT"
"${COMPOSE_CMD[@]}" ps
