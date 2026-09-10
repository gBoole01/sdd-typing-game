#!/bin/sh
# Restores a dump produced by db-dump.sh. Overwrites current data.
set -eu

if [ $# -ne 1 ]; then
  printf 'Usage: pnpm db:restore <path-to-dump.sql.gz>\n' >&2
  exit 1
fi

DUMP="$1"
[ -f "$DUMP" ] || { printf 'No such dump: %s\n' "$DUMP" >&2; exit 1; }

COMPOSE_FILE="$(dirname "$0")/../docker/docker-compose.yml"

gunzip -c "$DUMP" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-typing}" -d "${POSTGRES_DB:-typing_game}"

printf 'Restored %s\n' "$DUMP"
