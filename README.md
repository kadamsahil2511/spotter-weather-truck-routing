# Weather-aware truck routing

React + Django PWA that ranks three truck routes by the Spotter weather rules. The design notes are in [PLAN.md](./PLAN.md).

Routing is OpenRouteService `driving-hgv` when `ORS_API_KEY` is set. Requests go to `ORS_BASE_URL` (default `https://api.heigit.org/openrouteservice`, so the directions path is `/openrouteservice/v2/directions/driving-hgv`). If that host is unreachable, set `ORS_BASE_URL=https://api.openrouteservice.org`. Without a key the API still runs, using a labeled straight-line fixture so the rest of the pipeline can be tested. The key is never committed.

## API

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # optional; leave ORS_API_KEY empty until you have one
python manage.py runserver
```

Redis is optional. If `REDIS_URL` is unset, Django uses its in-process cache.

## UI

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8000`.

## Rules that the ranker will not bend

Wind is sustained `wind_speed_10m` in mph. Gust is shown and not scored. Rain and snow edges that two classes both name take the worse class (`0.25` in/hr is High, `0.50` is Severe, `1.00` stays Severe). Load upgrades use a strict `>` at 30,000 lb and 40,000 lb.

Sort: fewest Severe miles, then fewest High miles, then lowest mile-weighted average risk, then shortest travel time, then route id. No Travel miles are summarized and warned on. They are not a sort key.

## Tests

```bash
cd backend && .venv/bin/pytest
cd frontend && npm test
```

## Attribution

Weather from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Routes from [openrouteservice](https://openrouteservice.org/) by HeiGIT, data © OpenStreetMap contributors. Map tiles from [OpenFreeMap](https://openfreemap.org/) / OpenMapTiles / OSM.

Not deployed. Hosting (Vercel for the UI, the VPS API on port 8002) is described in PLAN.md and is still to do.

Loom: not recorded yet.
