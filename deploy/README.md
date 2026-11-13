# Deploy

`docker compose` in this repository builds from the repo root. The Django app is `backend/`.

```bash
cp .env.example .env   # placeholders only; .env is gitignored
docker compose -p fs-truck up -d --build api
```

The API listens on `127.0.0.1:8002` and serves `GET /api/health`.

## VPS

Production does not build inside the clone. `/opt/fs-truck` is the Docker context, and the clone is `src/` next to the compose files:

```
/opt/fs-truck/
  Dockerfile           # COPY src/backend, because this directory is the context
  docker-compose.yml
  .dockerignore
  .env                 # real secrets, not in git
  src/                 # clone of this repo, branch main
```

The files committed here match that compose project, with `src/backend` rewritten to `backend/` so a checkout builds on its own. The copies Docker actually runs stay in `/opt/fs-truck` and still copy `src/backend`.

Deploy updates only the clone, then rebuilds the API from the parent directory:

```bash
cd /opt/fs-truck/src && git fetch origin main && git checkout -B main origin/main && git reset --hard origin/main
cd /opt/fs-truck && docker compose -p fs-truck up -d --build api
```

Public health check: `https://fsapi.kadamsahil.com/api/health`.
