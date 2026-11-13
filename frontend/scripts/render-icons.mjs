import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "scripts", "icon.svg"), "utf8");

function raster(markup, size) {
  const rendered = new Resvg(markup, {
    fitTo: { mode: "width", value: size },
  }).render();
  return rendered.asPng();
}

function padded(size, insetRatio) {
  const inset = Math.round(size * insetRatio);
  const inner = size - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#fafaf9"/>
    <svg x="${inset}" y="${inset}" width="${inner}" height="${inner}" viewBox="0 0 512 512">
      ${svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}
    </svg>
  </svg>`;
}

const outputs = [
  ["public/icon-192.png", 192, 0.08],
  ["public/icon-512.png", 512, 0.08],
  ["public/icon-512-maskable.png", 512, 0.18],
  ["public/apple-touch-icon.png", 180, 0.08],
];

for (const [relative, size, inset] of outputs) {
  const png = raster(padded(size, inset), size);
  writeFileSync(join(root, relative), png);
  console.log(`${relative} ${png.length} bytes`);
}
