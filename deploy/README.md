# Deploy

The clone is the compose project. Secrets stay outside it.

```
/opt/fs-truck/.env          # not in git; compose reads this via ENV_FILE
/opt/fs-truck/src/          # git clone of this repo, branch main
  Dockerfile
  docker-compose.yml
  backend/
```

`docker-compose.yml` uses `env_file: ${ENV_FILE:-.env}`. On the VPS, `ENV_FILE=/opt/fs-truck/.env`. Locally, omit `ENV_FILE` and keep a gitignored `.env` next to the compose file. Images are tagged `fs-truck-api:${IMAGE_TAG:-latest}`. The deploy script tags a 12-character SHA and leaves the previous SHA tag in place for rollback.

The compose project name stays `fs-truck`. The API stays on `127.0.0.1:8002`. Redis stays in the same compose file.

## Local API and Redis

```bash
cp .env.example .env
# Replace DJANGO_SECRET_KEY. Compose sets DJANGO_DEBUG=0, and the
# placeholder secrets are refused.
docker compose -p fs-truck up -d --build
```

Frontend, from a separate shell:

```bash
cd frontend
npm ci
npm run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8000` for `runserver`. The compose API is on port 8002, so point the UI at it with `VITE_API_BASE=http://127.0.0.1:8002` when you are not using `runserver`.

## Migration from the current VPS layout

Current layout:

```
/opt/fs-truck/Dockerfile
/opt/fs-truck/docker-compose.yml
/opt/fs-truck/.dockerignore
/opt/fs-truck/.env
/opt/fs-truck/src/          # clone; old compose copied src/backend
```

Do this once, after this change is on `origin/main` and its CI run is green. The public health URL is `https://fsapi.kadamsahil.com/api/health`.

1. Confirm the site is healthy: `curl -fsS https://fsapi.kadamsahil.com/api/health`.
2. Update the clone:

   ```bash
   cd /opt/fs-truck/src
   git fetch origin main
   git checkout -B main origin/main
   git reset --hard origin/main
   ```

3. Keep the real env file where it is: `/opt/fs-truck/.env`. Do not move it into the clone. Confirm `DJANGO_SECRET_KEY` is set and is not `change-me`, `dev-only-change-me`, or `dev-only-not-for-production`. Compose forces `DJANGO_DEBUG=0`.
4. Optional override, same file: `DJANGO_ALLOWED_HOSTS=fsapi.kadamsahil.com,127.0.0.1,localhost`.
5. Move the old build files out of the Docker context so they cannot be used by mistake:

   ```bash
   mkdir -p /opt/fs-truck/previous-layout
   mv /opt/fs-truck/Dockerfile /opt/fs-truck/docker-compose.yml /opt/fs-truck/.dockerignore /opt/fs-truck/previous-layout/
   ```

6. Build from the clone. The project name, host port, and Redis service do not change:

   ```bash
   cd /opt/fs-truck/src
   ENV_FILE=/opt/fs-truck/.env IMAGE_TAG=$(git rev-parse --short=12 HEAD) \
     docker compose -p fs-truck up -d --build api
   ```

7. Confirm `curl -fsS http://127.0.0.1:8002/api/health` and `curl -fsS https://fsapi.kadamsahil.com/api/health`.
8. Install the timer that polls `origin/main` and deploys only a SHA whose CI workflow run concluded success:

   ```bash
   sudo cp /opt/fs-truck/src/deploy/fs-truck-deploy.sh /usr/local/bin/fs-truck-deploy.sh
   sudo chmod 755 /usr/local/bin/fs-truck-deploy.sh
   sudo cp /opt/fs-truck/src/deploy/fs-truck-deploy.service /etc/systemd/system/
   sudo cp /opt/fs-truck/src/deploy/fs-truck-deploy.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now fs-truck-deploy.timer
   ```

9. Record the SHA you just booted so the timer does not immediately rebuild it:

   ```bash
   sudo mkdir -p /var/lib/fs-truck
   git -C /opt/fs-truck/src rev-parse HEAD | sudo tee /var/lib/fs-truck/deployed_sha
   ```

The timer runs `/usr/local/bin/fs-truck-deploy.sh` every two minutes. That script fetches `origin/main`, deploys only when the CI workflow for that SHA succeeded, tags `fs-truck-api` with the 12-character SHA, keeps the previous SHA tag, and checks `https://fsapi.kadamsahil.com/api/health`. A failed health check starts the previous SHA tag again.

After this migration, update `/usr/local/bin/fs-truck-deploy.sh` from `deploy/fs-truck-deploy.sh` whenever that script changes on `main`. The image build itself always uses the Dockerfile in the clone.
