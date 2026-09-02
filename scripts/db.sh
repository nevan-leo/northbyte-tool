#!/usr/bin/env bash
# Northbound pipeline runner. Run from the project root.
#
#   scripts/db.sh all       rebuild the database from scratch and export the app data
#   scripts/db.sh init      schema + reference data only
#   scripts/db.sh stage     normalise source CSVs into data/staged/
#   scripts/db.sh load      load data/staged/ into the fact tables
#   scripts/db.sh model     (re)create views and the scoring model
#   scripts/db.sh export    write app/data/routes.json
#   scripts/db.sh psql      open a shell on the database
#
# Set SOURCE_DIR=data/raw once the real BTS and Statistics Canada extracts are
# downloaded; it defaults to the synthetic sample so a fresh clone still runs.

set -euo pipefail

DB=${DB:-northbound}
SOURCE_DIR=${SOURCE_DIR:-data/sample}
T100_FILE=${T100_FILE:-$SOURCE_DIR/t100_segment.csv}
OD_FILE=${OD_FILE:-$SOURCE_DIR/od_demand.csv}

# Homebrew's postgresql@17 is keg-only, and the server refuses to start unless
# the locale is fully specified.
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
export LC_ALL=${LC_ALL:-en_US.UTF-8}

run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

ensure_db() {
  psql -lqt | cut -d'|' -f1 | grep -qw "$DB" || createdb "$DB"
}

init()  { ensure_db; run db/00_schema.sql; run db/01_reference.sql; }
stage() {
  python3 scripts/normalize.py --source t100 "$T100_FILE" data/staged/t100_segment.csv
  python3 scripts/normalize.py --source od   "$OD_FILE"   data/staged/od_demand.csv
}
load()  { run db/10_load.sql; }
model() { run db/20_views.sql; run db/30_scoring.sql; }
export_json() {
  mkdir -p app/data
  psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -f db/40_export.sql > app/data/routes.json
  echo "wrote app/data/routes.json ($(wc -c < app/data/routes.json) bytes)"
}

case "${1:-all}" in
  init)   init ;;
  stage)  stage ;;
  load)   load ;;
  model)  model ;;
  export) export_json ;;
  psql)   psql -d "$DB" ;;
  all)    init; stage; load; model; export_json ;;
  *)      sed -n '2,16p' "$0" >&2; exit 2 ;;
esac
