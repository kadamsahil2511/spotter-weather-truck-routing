#!/usr/bin/env bash
# Pull-based deploy. The git clone is the compose project directory.
# Secrets stay outside the clone at /opt/fs-truck/.env.
set -euo pipefail

COMPOSE_DIR="/opt/fs-truck/src"
REPO_DIR="/opt/fs-truck/src"
ENV_FILE="/opt/fs-truck/.env"
PROJECT="fs-truck"
SERVICE="api"
IMAGE="fs-truck-api"
STATE_DIR="/var/lib/fs-truck"
STATE_FILE="${STATE_DIR}/deployed_sha"
LOCK_FILE="${STATE_DIR}/deploy.lock"
HEALTH_URL="https://fsapi.kadamsahil.com/api/health"
LOCAL_HEALTH_URL="http://127.0.0.1:8002/api/health"
GITHUB_API="https://api.github.com/repos/kadamsahil2511/spotter-weather-truck-routing"
WORKFLOW_PATH=".github/workflows/ci.yml"
WORKFLOW_NAME="CI"
USER_AGENT="fs-truck-deploy/1.0"
HEALTH_ATTEMPTS=12
HEALTH_SLEEP=5

export GIT_TERMINAL_PROMPT=0
export ENV_FILE

log() {
  if [[ -n "${JOURNAL_STREAM:-}" ]]; then
    logger -t fs-truck-deploy -- "$*"
  else
    logger -s -t fs-truck-deploy -- "$*" 2>&1
  fi
}

short_sha() {
  git -C "${REPO_DIR}" rev-parse --short=12 "$1"
}

compose() {
  docker compose -p "${PROJECT}" -f "${COMPOSE_DIR}/docker-compose.yml" --project-directory "${COMPOSE_DIR}" "$@"
}

mkdir -p "${STATE_DIR}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  log "already running, exiting"
  exit 0
fi

PREV_HEAD=""
PREV_SHORT=""
IMAGE_PREVIOUS_TAGGED=0
DEPLOY_STARTED=0

health_ok() {
  local url="$1"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "${url}" || true)"
  [[ "${code}" == "200" ]]
}

wait_for_health() {
  local i
  for i in $(seq 1 "${HEALTH_ATTEMPTS}"); do
    if health_ok "${LOCAL_HEALTH_URL}"; then
      if health_ok "${HEALTH_URL}"; then
        log "health check passed (local and ${HEALTH_URL}) attempt ${i}"
      else
        log "health check passed locally; public ${HEALTH_URL} not 200 yet, attempt ${i}"
      fi
      return 0
    fi
    log "health check not ready, attempt ${i}/${HEALTH_ATTEMPTS}"
    sleep "${HEALTH_SLEEP}"
  done
  return 1
}

rollback() {
  set +e
  log "rolling back after failed deploy of ${SHA:-unknown}"
  if [[ -n "${PREV_SHORT}" ]] && docker image inspect "${IMAGE}:${PREV_SHORT}" >/dev/null 2>&1; then
    IMAGE_TAG="${PREV_SHORT}" compose up -d --no-build --force-recreate "${SERVICE}"
    log "restored ${IMAGE}:${PREV_SHORT}"
  elif [[ "${IMAGE_PREVIOUS_TAGGED}" -eq 1 ]] && docker image inspect "${IMAGE}:previous" >/dev/null 2>&1; then
    IMAGE_TAG="previous" compose up -d --no-build --force-recreate "${SERVICE}"
    log "restored ${IMAGE}:previous"
  elif [[ -n "${PREV_HEAD}" ]]; then
    log "no previous image tag; checking out ${PREV_HEAD} and rebuilding"
    git -C "${REPO_DIR}" checkout -f "${PREV_HEAD}"
    IMAGE_TAG="$(short_sha "${PREV_HEAD}")" compose up -d --build "${SERVICE}"
  else
    log "error: no previous image or SHA available to roll back to"
  fi
  if wait_for_health; then
    log "rollback health check passed"
  else
    log "error: rollback health check failed"
  fi
}

on_error() {
  local line="$1"
  log "error at line ${line}"
  if [[ "${DEPLOY_STARTED}" -eq 1 ]]; then
    rollback
  fi
  exit 1
}
trap 'on_error $LINENO' ERR

if ! git -C "${REPO_DIR}" fetch -q origin refs/heads/main:refs/remotes/origin/main; then
  log "error: git fetch origin main failed"
  exit 1
fi

SHA="$(git -C "${REPO_DIR}" rev-parse --verify origin/main)"
if [[ -z "${SHA}" ]]; then
  log "error: could not resolve origin/main"
  exit 1
fi
SHORT="$(short_sha "${SHA}")"

LAST=""
if [[ -f "${STATE_FILE}" ]]; then
  LAST="$(tr -d '[:space:]' < "${STATE_FILE}")"
fi

if [[ -n "${LAST}" && "${SHA}" == "${LAST}" ]]; then
  exit 0
fi

if ! git -C "${REPO_DIR}" cat-file -e "${SHA}:${WORKFLOW_PATH}" 2>/dev/null; then
  log "no ci.yml on main, not deploying ${SHA}"
  exit 0
fi

TMP_JSON="$(mktemp)"
cleanup_tmp() { rm -f "${TMP_JSON}"; }
trap 'cleanup_tmp; on_error $LINENO' ERR
if ! curl -sS -A "${USER_AGENT}" -H "Accept: application/vnd.github+json" \
    --fail --max-time 20 \
    "${GITHUB_API}/actions/runs?head_sha=${SHA}&branch=main&per_page=30" \
    -o "${TMP_JSON}"; then
  log "waiting for green CI for ${SHA} (GitHub API request failed)"
  cleanup_tmp
  trap 'on_error $LINENO' ERR
  exit 0
fi

GREEN="$(jq -r --arg path "${WORKFLOW_PATH}" --arg name "${WORKFLOW_NAME}" --arg sha "${SHA}" '
  [.workflow_runs[]
    | select((.path == $path or .name == $name) and .head_sha == $sha)
    | select(.status == "completed" and .conclusion == "success")
  ] | length
' "${TMP_JSON}")"
cleanup_tmp
trap 'on_error $LINENO' ERR

if [[ "${GREEN}" -lt 1 ]]; then
  log "waiting for green CI for ${SHA}"
  exit 0
fi

log "green CI found for ${SHA}, deploying ${IMAGE}:${SHORT}"
PREV_HEAD="$(git -C "${REPO_DIR}" rev-parse HEAD)"
if [[ -n "${LAST}" ]]; then
  PREV_SHORT="$(git -C "${REPO_DIR}" rev-parse --short=12 "${LAST}" 2>/dev/null || true)"
fi
DEPLOY_STARTED=1

if [[ -n "${PREV_SHORT}" ]] && docker image inspect "${IMAGE}:${PREV_SHORT}" >/dev/null 2>&1; then
  log "keeping ${IMAGE}:${PREV_SHORT} for rollback"
elif docker image inspect "${IMAGE}:latest" >/dev/null 2>&1; then
  docker tag "${IMAGE}:latest" "${IMAGE}:previous"
  IMAGE_PREVIOUS_TAGGED=1
  log "tagged ${IMAGE}:latest as ${IMAGE}:previous"
else
  log "no current ${IMAGE}:latest to tag as previous"
fi

git -C "${REPO_DIR}" checkout -B main origin/main
git -C "${REPO_DIR}" reset --hard origin/main

if [[ ! -f "${REPO_DIR}/backend/requirements.txt" || ! -f "${REPO_DIR}/backend/config/wsgi.py" || ! -f "${REPO_DIR}/docker-compose.yml" ]]; then
  log "error: compose project files are missing after checkout of ${SHA}"
  rollback
  exit 1
fi

IMAGE_TAG="${SHORT}" compose up -d --build "${SERVICE}"

if wait_for_health; then
  docker tag "${IMAGE}:${SHORT}" "${IMAGE}:latest"
  printf '%s\n' "${SHA}" > "${STATE_FILE}"
  log "deployed ${SHA} as ${IMAGE}:${SHORT}"
  exit 0
fi

log "health check failed after deploy of ${SHA}"
rollback
exit 1
