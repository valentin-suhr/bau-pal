#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PNG } from "pngjs";
import { fitAffineTransform } from "./lib/affine-georeference.mjs";

const [imageArgument, controlsArgument, planKey, databaseArgument, outputArgument] = process.argv.slice(2);
if (!imageArgument || !controlsArgument || !planKey || !databaseArgument || !outputArgument) {
  throw new Error("Usage: render-georef-parcel-overlay.mjs <crop.png> <controls.json> <plan-key> <database.sqlite> <output.png>");
}
const image = PNG.sync.read(await readFile(resolve(imageArgument)));
const controls = JSON.parse(await readFile(resolve(controlsArgument), "utf8"));
const coefficients = fitAffineTransform(controls.controlPoints).coefficients;
const [a, b, c] = coefficients.longitude;
const [d, e, f] = coefficients.latitude;
const determinant = a * e - b * d;
const origin = controls.image?.cropOrigin ?? [0, 0];
const toPixel = ([longitude, latitude]) => {
  const u = longitude - c;
  const v = latitude - f;
  return [(e * u - b * v) / determinant - origin[0], (-d * u + a * v) / determinant - origin[1]];
};

function paint(x, y, color, radius = 1) {
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const px = Math.round(x + dx); const py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
    const offset = (py * image.width + px) * 4;
    image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
  }
}

function line(from, to, color) {
  const length = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  for (let step = 0; step <= length; step += 1) {
    const ratio = length ? step / length : 0;
    paint(from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio, color, 2);
  }
}

function rings(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  throw new Error(`Unsupported parcel geometry ${geometry.type}`);
}

const database = new DatabaseSync(resolve(databaseArgument), { readOnly: true });
const parcels = database.prepare(`
  SELECT p.id, p.geometry_geojson, p.centroid_lng, p.centroid_lat
  FROM parcel_planning_segments s
  JOIN parcels p ON p.id = s.parcel_id
  JOIN planning_zones z ON z.id = s.zone_id
  WHERE z.zone_key = ? AND s.is_controlling = 1
  ORDER BY p.id
`).all(`${planKey}:scope`);
database.close();
const palette = [
  [220, 0, 0], [0, 80, 230], [185, 0, 185], [0, 145, 80],
  [230, 90, 0], [20, 20, 20], [0, 175, 195], [125, 95, 0],
  [100, 45, 185], [90, 150, 0], [220, 40, 125], [0, 125, 125],
];
for (const [index, parcel] of parcels.entries()) {
  const color = palette[index % palette.length];
  for (const ring of rings(JSON.parse(parcel.geometry_geojson))) {
    const pixels = ring.map(toPixel);
    for (let point = 1; point < pixels.length; point += 1) line(pixels[point - 1], pixels[point], color);
  }
  const centre = toPixel([parcel.centroid_lng, parcel.centroid_lat]);
  paint(centre[0], centre[1], color, 9);
}
await writeFile(resolve(outputArgument), PNG.sync.write(image));
console.log(JSON.stringify({ output: resolve(outputArgument), planKey, parcelCount: parcels.length }, null, 2));
