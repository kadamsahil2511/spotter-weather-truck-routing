#!/bin/sh
set -eu
workers="${WEB_CONCURRENCY:-1}"
threads="${GUNICORN_THREADS:-2}"
python manage.py check --deploy
exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${workers}" \
  --threads "${threads}" \
  --timeout 60 \
  --graceful-timeout 10 \
  --max-requests 500 \
  --max-requests-jitter 50 \
  --access-logfile - \
  --error-logfile -
