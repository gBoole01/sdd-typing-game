#!/bin/sh
# Local backup (spec 002 § 8). Runs pg_dump inside the container, so no host
# postgres client is required (US-1.3).
set -eu

ROOT="$(dirname "$0")/.."
COMPOSE_FILE="$ROOT/docker/docker-compose.yml"
BACKUP_DIR="$ROOT/.backups"

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
TARGET="$BACKUP_DIR/$STAMP.sql.gz"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-typing}" -d "${POSTGRES_DB:-typing_game}" \
  | gzip > "$TARGET"

printf 'Wrote %s\n' "$TARGET"
