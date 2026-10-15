#!/usr/bin/env bash
# Runs src/__tests__/community.integration.test.ts against a real PostgREST
# over schema.sql + storage.sql + photos.sql, with row-level security on.
# Needs Postgres server binaries and a PostgREST 12 binary (on PATH, or set
# POSTGREST=/path/to/postgrest). Usage: bash supabase/tests/api.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
repo="$(cd "$root/.." && pwd)"

if ! command -v initdb >/dev/null 2>&1; then
  pgbin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$pgbin" ] && export PATH="$pgbin:$PATH"
fi
command -v initdb >/dev/null || { echo "Postgres server binaries not found (initdb)."; exit 1; }
POSTGREST="${POSTGREST:-$(command -v postgrest || true)}"
[ -x "$POSTGREST" ] || { echo "PostgREST not found. Download v12 from https://github.com/PostgREST/postgrest/releases and set POSTGREST."; exit 1; }

pgport="${PGTEST_PORT:-54331}"; apiport=3901; proxyport=3902
secret="forge-integration-secret-$(date +%s)-padding-padding"
tmp="$(mktemp -d)"; pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  run "pg_ctl -D '$tmp/data' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "PATH='$PATH' $*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$tmp"

run "initdb -D '$tmp/data' -U postgres -A trust >/dev/null"
run "pg_ctl -D '$tmp/data' -o '-p $pgport -c listen_addresses=127.0.0.1 -k $tmp' -l '$tmp/log' -w start >/dev/null"
pg="postgres://postgres@127.0.0.1:$pgport/postgres"
p() { psql "$pg" -v ON_ERROR_STOP=1 -q "$@" >/dev/null 2>&1; }
p -f "$here/supabase_shim.sql"; p -f "$root/schema.sql"; p -f "$root/storage.sql"; p -f "$root/photos.sql"; p -f "$root/social.sql"; p -f "$root/unblock.sql"
p -c "create role authenticator login noinherit password 'pw'; grant anon, authenticated to authenticator;"
p -c "insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111','alice@x'), ('22222222-2222-4222-8222-222222222222','bob@x');"
p -c "insert into public.profiles (id, display_name) values ('11111111-1111-4111-8111-111111111111','Alice'), ('22222222-2222-4222-8222-222222222222','Bob');"

cat > "$tmp/pgrst.conf" <<CONF
db-uri = "postgres://authenticator:pw@127.0.0.1:$pgport/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$secret"
server-port = $apiport
CONF
"$POSTGREST" "$tmp/pgrst.conf" > "$tmp/pgrst.log" 2>&1 & pids+=($!)
# supabase-js calls <url>/rest/v1/...; PostgREST serves at /.
node -e "
const http = require('node:http');
http.createServer((req, res) => {
  if (!req.url.startsWith('/rest/v1')) { res.writeHead(404); return res.end(); }
  const up = http.request({ host: '127.0.0.1', port: $apiport, path: req.url.slice(8) || '/', method: req.method, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(up);
}).listen($proxyport);" & pids+=($!)
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$proxyport/rest/v1/" >/dev/null && break; sleep 0.2; done

cd "$repo"
FORGE_API_URL="http://127.0.0.1:$proxyport" FORGE_JWT_SECRET="$secret" FORGE_PG_URL="$pg" \
  npx vitest run src/__tests__/community.integration.test.ts
