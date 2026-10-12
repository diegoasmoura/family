#!/bin/sh
# Dump diário do Postgres em /backups, apagando arquivos mais velhos que BACKUP_RETENTION_DAYS.
set -eu

RETENTION="${BACKUP_RETENTION_DAYS:-30}"
HOUR=$(printf '%02d' "${BACKUP_HOUR:-3}")

backup() {
  file="/backups/financas-$(date +%Y%m%d-%H%M%S).sql.gz"
  if pg_dump --no-owner --clean --if-exists | gzip > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "[backup] gravado $file"
  else
    rm -f "$file.tmp"
    echo "[backup] falhou" >&2
  fi
  find /backups -name 'financas-*.sql.gz' -mtime +"$RETENTION" -delete
}

backup
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) ${HOUR}:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup
done
