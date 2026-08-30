#!/bin/sh
# Runs a command against the local Postgres container from docker-compose.yml,
# never against the database configured in .env.local.
#
# .env.local points at the staging Supabase database. Both the Prisma CLI (through
# prisma.config.ts) and Next.js load that file, but shell variables take precedence
# over it — so exporting the URLs here is what pins everything below to localhost.
set -e

LOCAL_DB="postgresql://postgres:postgres@localhost:5432/adhera"

export DATABASE_URL="$LOCAL_DB"
export DIRECT_URL="$LOCAL_DB"   # prisma.config.ts reads DIRECT_URL first for migrations

# prisma/seed.ts refuses to fall back to a default for SEED_SUPER_ADMIN_PASSWORD on
# purpose, so a real database can never be seeded with a well-known password.
# Supplying one here is safe only because the two exports above make localhost the
# only reachable target. Override any of these by setting them before the command.
export SEED_SUPER_ADMIN_PASSWORD="${SEED_SUPER_ADMIN_PASSWORD:-devpass}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-devpass}"
export SEED_MEMBRE_PASSWORD="${SEED_MEMBRE_PASSWORD:-devpass}"
export SEED_DEMO_DATA=true

exec "$@"
