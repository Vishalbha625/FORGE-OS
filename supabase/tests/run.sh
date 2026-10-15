#!/usr/bin/env bash
# Runs the row-level security tests against a throwaway local Postgres.
# Needs Postgres server binaries (initdb, pg_ctl) on PATH or under /usr/lib/postgresql/*/bin.
# Usage: bash supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

if ! command -v initdb >/dev/null 2>&1; then
  pgbin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$pgbin" ] && export PATH="$pgbin:$PATH"
fi
command -v initdb >/dev/null || { echo "Postgres server binaries not found (initdb)."; exit 1; }

tmp="$(mktemp -d)"
port="${PGTEST_PORT:-54329}"
cleanup() { run "pg_ctl -D '$tmp/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

# Postgres refuses to run as root; use the postgres user if we are root.
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "PATH='$PATH' $*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$tmp" && chmod 755 "$root" "$here" 2>/dev/null || true

run "initdb -D '$tmp/data' -U postgres -A trust >/dev/null"
run "pg_ctl -D '$tmp/data' -o '-p $port -k $tmp -c listen_addresses=' -l '$tmp/log' -w start >/dev/null"

psql_run() { run "psql -h '$tmp' -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -q $*"; }
psql_run "-f '$here/supabase_shim.sql'" >/dev/null
psql_run "-f '$root/schema.sql'" >/dev/null
psql_run "-f '$root/storage.sql'" >/dev/null
psql_run "-f '$root/photos.sql'" >/dev/null
psql_run "-f '$root/social.sql'" >/dev/null
psql_run "-f '$root/unblock.sql'" >/dev/null
psql_run "-f '$here/rls_test.sql'"
