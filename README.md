# Weather-aware truck routing

React + Django PWA that ranks three truck routes by the Spotter weather rules. The design notes are in [PLAN.md](./PLAN.md).

Routing is OpenRouteService `driving-hgv` when `ORS_API_KEY` is set. Requests go to `ORS_BASE_URL` (default `https://api.heigit.org/openrouteservice`, so the directions path is `/openrouteservice/v2/directions/driving-hgv`). If that host is unreachable, set `ORS_BASE_URL=https://api.openrouteservice.org`. Without a key the API still runs, using a labeled straight-line fixture so the rest of the pipeline can be tested. The key is never committed.

## API

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # optional; leave ORS_API_KEY empty until you have one
python manage.py runserver
```

`requirements.txt` is what the API image installs. `requirements-dev.txt` adds pytest. Redis is optional. If `REDIS_URL` is unset, Django uses its in-process cache.

The same API and Redis stack used in production:

```bash
cp .env.example .env
# Set DJANGO_SECRET_KEY. Compose turns debug off, and placeholder secrets will not boot.
docker compose -p fs-truck up -d --build
```

That listens on `127.0.0.1:8002`. See [deploy/README.md](./deploy/README.md).

## UI

```bash
cd frontend
npm ci
npm run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8000`. For the compose API, set `VITE_API_BASE=http://127.0.0.1:8002`.

## Twelve-factor

| Factor | Where |
|---|---|
| Codebase | One repo. `Dockerfile` and `docker-compose.yml` at the root are what the VPS builds. |
| Dependencies | `backend/requirements.txt` in the image. `requirements-dev.txt` for pytest. `frontend/package-lock.json` via `npm ci`. |
| Config | Environment variables. Debug off refuses a missing or placeholder `DJANGO_SECRET_KEY`. Hosts come from `DJANGO_ALLOWED_HOSTS`. |
| Backing services | Redis through `REDIS_URL`. Unset locally, the cache stays in process. |
| Build, release, run | Image `fs-truck-api:<12-char SHA>`. The timer in `deploy/` releases only a SHA whose CI run succeeded. |
| Processes | One stateless gunicorn process. No requests are stored on disk. |
| Port binding | The container binds `8000`. Compose publishes `127.0.0.1:8002`. |
| Concurrency | `WEB_CONCURRENCY` (default 1) and `GUNICORN_THREADS` (default 2) in `backend/entrypoint.sh`. |
| Disposability | `--graceful-timeout 10`, `--max-requests 500` with jitter, and `stop_grace_period: 20s`. |
| Dev/prod parity | Local `docker compose up` uses this same compose file and image. The UI stays `npm ci`. |
| Logs | Django `LOGGING` writes to stdout. `LOG_LEVEL` defaults to `INFO`. Gunicorn access and error logs also go to stdout. |
| Admin processes | No separate admin service. One-off commands are `python manage.py` against the same settings. |

## Rules that the ranker will not bend

Wind is sustained `wind_speed_10m` in mph. Gust is shown and not scored. Rain and snow edges that two classes both name take the worse class (`0.25` in/hr is High, `0.50` is Severe, `1.00` stays Severe). Load upgrades use a strict `>` at 30,000 lb and 40,000 lb.

Sort: fewest Severe miles, then fewest High miles, then lowest mile-weighted average risk, then shortest travel time, then route id. No Travel miles are summarized and warned on. They are not a sort key.

## Tests

```bash
cd backend && .venv/bin/python -m pytest
cd frontend && npm test
```

## Attribution

Weather from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Routes from [openrouteservice](https://openrouteservice.org/) by HeiGIT, data © OpenStreetMap contributors. Map tiles from [OpenFreeMap](https://openfreemap.org/) / OpenMapTiles / OSM.

The UI is on Vercel. The API container is on the VPS at port 8002. Migration steps are in [deploy/README.md](./deploy/README.md).

Loom: not recorded yet.
