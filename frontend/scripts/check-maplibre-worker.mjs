import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDir = join("dist", "assets");
const assets = readdirSync(assetsDir);
const workers = assets.filter((name) => name.startsWith("maplibre-gl-worker") && name.endsWith(".mjs"));

if (workers.length !== 1) {
  console.error(`expected one maplibre-gl-worker-*.mjs in dist/assets, found ${workers.length}: ${workers.join(", ")}`);
  process.exit(1);
}

const workerPath = join(assetsDir, workers[0]);
const size = statSync(workerPath).size;
if (size < 50_000) {
  console.error(`${workers[0]} is ${size} bytes, which is too small to be the MapLibre worker`);
  process.exit(1);
}

const bundles = assets.filter((name) => name.endsWith(".js"));
const referenced = bundles.some((name) => readFileSync(join(assetsDir, name), "utf8").includes(workers[0]));
if (!referenced) {
  console.error(`${workers[0]} is in dist but no JS bundle points setWorkerUrl at it`);
  process.exit(1);
}

console.log(`maplibre worker ok: ${workers[0]} (${size} bytes)`);
