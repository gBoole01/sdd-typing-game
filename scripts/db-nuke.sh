#!/bin/sh
# Destroys the development database volume. Data loss is the point, so it asks.
set -eu

COMPOSE_FILE="$(dirname "$0")/../docker/docker-compose.yml"

printf 'This destroys the tg-pgdata volume and every row in the development database.\n'
printf 'Type "nuke" to confirm: '
read -r reply

if [ "$reply" != "nuke" ]; then
  printf 'Aborted.\n'
  exit 1
fi

docker compose -f "$COMPOSE_FILE" down -v
printf 'Volume destroyed. Run `pnpm db:up && pnpm db:migrate && pnpm db:seed` to rebuild.\n'
