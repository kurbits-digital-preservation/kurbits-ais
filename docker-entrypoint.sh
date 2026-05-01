#!/bin/sh
set -e

echo "==> Kurbits AIS starting"

# Run DB migrations (idempotent — safe to run on every start)
echo "==> Running database migrations"
flask db upgrade

echo "==> Starting Gunicorn"
exec gunicorn \
    --bind "0.0.0.0:${PORT:-8080}" \
    --workers "${GUNICORN_WORKERS:-2}" \
    --threads "${GUNICORN_THREADS:-2}" \
    --worker-class gthread \
    --timeout 120 \
    --keep-alive 5 \
    --log-level "${LOG_LEVEL:-info}" \
    --access-logfile - \
    --error-logfile - \
    "run:app"
