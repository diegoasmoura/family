#!/bin/sh
# Confere o mesmo caminho do backup diário: pg_dump compactado e restore num banco vazio.
# Sobe um Postgres descartável, não usa o volume do NAS.
set -eu

NAME="financas-restore-check-$$"
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/backups/restore-check"
DUMP="$OUT/financas-restore-check.sql.gz"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$OUT"
docker run -d --name "$NAME" \
  -e POSTGRES_USER=financas \
  -e POSTGRES_PASSWORD=restore-check \
  -e POSTGRES_DB=financas \
  postgres:16-alpine >/dev/null

i=0
while [ "$i" -lt 30 ]; do
  if docker exec -e PGPASSWORD=restore-check "$NAME" pg_isready -U financas -d financas >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
docker exec -e PGPASSWORD=restore-check "$NAME" pg_isready -U financas -d financas >/dev/null

docker exec -e PGPASSWORD=restore-check "$NAME" \
  psql -U financas -d financas -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE marco (id integer primary key, note text); INSERT INTO marco VALUES (1, 'ok');"

docker exec -e PGPASSWORD=restore-check "$NAME" \
  pg_dump -U financas --no-owner --clean --if-exists financas | gzip > "$DUMP.tmp"
mv "$DUMP.tmp" "$DUMP"

docker exec -e PGPASSWORD=restore-check "$NAME" \
  psql -U financas -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE financas;" -c "CREATE DATABASE financas;"

gunzip -c "$DUMP" | docker exec -i -e PGPASSWORD=restore-check "$NAME" \
  psql -U financas -d financas -v ON_ERROR_STOP=1 >/dev/null

note="$(docker exec -e PGPASSWORD=restore-check "$NAME" psql -U financas -d financas -tAc "SELECT note FROM marco")"
note="$(printf '%s' "$note" | tr -d '[:space:]')"
if [ "$note" != "ok" ]; then
  echo "[restore-check] marco ausente: $note" >&2
  exit 1
fi

echo "[restore-check] backup e restore conferidos em $DUMP"
