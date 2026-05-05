# ─── Stage 1: Build React frontend ───────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline

COPY frontend/ ./
RUN npm run build


# ─── Stage 2: Python application ──────────────────────────────────────
FROM python:3.13-slim AS app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libxml2 \
        libxslt1.1 \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/uploads /app/logs /app/data /app/database \
    && chown -R 1001:0 /app \
    && chmod -R g+rwX /app

# Skriv entrypoint
RUN printf '#!/bin/sh\nset -e\necho "==> Kurbits AIS starting"\necho "==> Running database migrations"\nflask db upgrade\necho "==> Starting Gunicorn"\nexec gunicorn \\\n    --bind "0.0.0.0:${PORT:-8080}" \\\n    --workers "${GUNICORN_WORKERS:-2}" \\\n    --threads "${GUNICORN_THREADS:-2}" \\\n    --worker-class gthread \\\n    --timeout 120 \\\n    --keep-alive 5 \\\n    --log-level "${LOG_LEVEL:-info}" \\\n    --access-logfile - \\\n    --error-logfile - \\\n    "run:app"\n' > /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh \
    && chown 1001:0 /app/entrypoint.sh
RUN chown -R 1001:0 /app/database && chmod -R 775 /app/database
USER 1001

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]