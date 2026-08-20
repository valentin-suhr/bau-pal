import { PNG } from "pngjs";
import proj4 from "proj4";

export const SOLDNER_BERLIN_PROJ4 = "+proj=cass +lat_0=52.41864827777778 +lon_0=13.62720366666667 +x_0=40000 +y_0=10000 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs";

function darkNeutral(png, x, y, threshold = 170, chroma = 35) {
  const offset = (y * png.width + x) * 4;
  const values = [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
  return Math.max(...values) < threshold && Math.max(...values) - Math.min(...values) < chroma;
}

function clusterPeaks(scores, minimum) {
  const clusters = [];
  for (let index = 0; index < scores.length; index += 1) {
    if (scores[index] < minimum) continue;
    const start = index;
    let weighted = 0;
    let weight = 0;
    let peak = 0;
    while (index < scores.length && scores[index] >= minimum) {
      weighted += index * scores[index];
      weight += scores[index];
      peak = Math.max(peak, scores[index]);
      index += 1;
    }
    clusters.push({ start, end: index - 1, centre: weighted / weight, peak });
  }
  return clusters;
}

function chooseRegular(clusters, expectedCount, dimension, expectedSpacingPx, spacingTolerance = 0.08) {
  if (clusters.length < expectedCount) throw new Error(`Only ${clusters.length} grid-line candidates found; expected ${expectedCount}`);
  // Bound hypothesis search on noisy sheets. Low-ranked peaks are mostly text
  // strokes; if a true grid line falls outside this set, detection fails closed.
  const sorted = [...clusters].sort((a, b) => b.peak - a.peak).slice(0, 256).sort((a, b) => a.centre - b.centre);
  const hypotheses = [];
  if (expectedCount === 2) {
    for (let left = 0; left < sorted.length; left += 1) for (let right = left + 1; right < sorted.length; right += 1) hypotheses.push([sorted[left], sorted[right]]);
  } else for (let left = 0; left < sorted.length; left += 1) for (let right = left + expectedCount - 1; right < sorted.length; right += 1) {
    const spacing = (sorted[right].centre - sorted[left].centre) / (expectedCount - 1);
    if (spacing * (expectedCount - 1) < dimension * 0.25) continue;
    const choice = [sorted[left]];
    let previousIndex = left;
    let valid = true;
    for (let step = 1; step < expectedCount - 1; step += 1) {
      const target = sorted[left].centre + spacing * step;
      let bestIndex = -1;
      let bestDistance = Infinity;
      for (let index = previousIndex + 1; index < right; index += 1) {
        const distance = Math.abs(sorted[index].centre - target);
        if (distance < bestDistance) { bestIndex = index; bestDistance = distance; }
      }
      if (bestIndex < 0 || bestDistance > spacing * 0.08) { valid = false; break; }
      choice.push(sorted[bestIndex]); previousIndex = bestIndex;
    }
    if (valid) hypotheses.push([...choice, sorted[right]]);
  }
  const scored = hypotheses.map((choice) => {
    const gaps = choice.slice(1).map((item, index) => item.centre - choice[index].centre);
    const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    const irregularity = Math.max(...gaps.map((value) => Math.abs(value - mean))) / mean;
    const span = choice.at(-1).centre - choice[0].centre;
    const strength = choice.reduce((sum, item) => sum + item.peak, 0) / choice.length / dimension;
    const spacingError = expectedSpacingPx == null ? 0 : Math.abs(mean - expectedSpacingPx) / expectedSpacingPx;
    return { choice, mean, irregularity, span, strength, spacingError, score: irregularity + spacingError - span / dimension * 0.02 - strength * 0.01 };
  }).filter((item) => item.span >= dimension * 0.25 && (expectedSpacingPx == null || item.spacingError <= spacingTolerance)).sort((a, b) => a.score - b.score);
  if (!scored.length) throw new Error("No regularly spaced grid-line combination spans at least 25% of the crop");
  const best = scored[0];
  if (best.irregularity > 0.035) throw new Error(`Grid spacing irregularity ${(best.irregularity * 100).toFixed(2)}% exceeds 3.5%`);
  return best;
}

function median(values) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function linearFit(points) {
  const n = points.length;
  const sx = points.reduce((sum, point) => sum + point[0], 0);
  const sy = points.reduce((sum, point) => sum + point[1], 0);
  const sxx = points.reduce((sum, point) => sum + point[0] ** 2, 0);
  const sxy = points.reduce((sum, point) => sum + point[0] * point[1], 0);
  const denominator = n * sxx - sx ** 2;
  if (n < 20 || Math.abs(denominator) < 1e-9) throw new Error("Insufficient pixels for grid-line regression");
  const a = (n * sxy - sx * sy) / denominator;
  return { a, b: (sy - a * sx) / n, sampleCount: n };
}

function fitLine(png, axis, centre, radius = 4) {
  const along = axis === "vertical" ? png.height : png.width;
  const across = axis === "vertical" ? png.width : png.height;
  const points = [];
  for (let position = 0; position < along; position += 1) {
    const hits = [];
    const low = Math.max(0, Math.floor(centre - radius));
    const high = Math.min(across - 1, Math.ceil(centre + radius));
    for (let value = low; value <= high; value += 1) {
      const x = axis === "vertical" ? value : position;
      const y = axis === "vertical" ? position : value;
      if (darkNeutral(png, x, y)) hits.push(value);
    }
    if (hits.length) points.push([position, median(hits)]);
  }
  return linearFit(points);
}

function intersection(vertical, horizontal) {
  // x = av*y+bv; y = ah*x+bh
  const y = (horizontal.a * vertical.b + horizontal.b) / (1 - horizontal.a * vertical.a);
  return [vertical.a * y + vertical.b, y];
}

export function extractSoldnerGridControls(buffer, options) {
  const png = PNG.sync.read(buffer);
  const eastings = options.eastings;
  const northings = options.northings;
  if (eastings.length < 2 || northings.length < 2) throw new Error("At least two eastings and two northings are required");
  const xScores = Array.from({ length: png.width }, (_, x) => {
    let count = 0; for (let y = 0; y < png.height; y += 1) if (darkNeutral(png, x, y)) count += 1; return count;
  });
  const yScores = Array.from({ length: png.height }, (_, y) => {
    let count = 0; for (let x = 0; x < png.width; x += 1) if (darkNeutral(png, x, y)) count += 1; return count;
  });
  const verticalSelection = chooseRegular(clusterPeaks(xScores, png.height * (options.minimumCoverage ?? 0.2)), eastings.length, png.width, options.expectedSpacingPx, options.spacingTolerance);
  const horizontalSelection = chooseRegular(clusterPeaks(yScores, png.width * (options.minimumCoverage ?? 0.2)), northings.length, png.height, options.expectedSpacingPx, options.spacingTolerance);
  const vertical = verticalSelection.choice.map((candidate) => ({ candidate, ...fitLine(png, "vertical", candidate.centre) }));
  const horizontal = horizontalSelection.choice.map((candidate) => ({ candidate, ...fitLine(png, "horizontal", candidate.centre) }));
  const cropOrigin = options.cropOrigin ?? [0, 0];
  const crs = options.crs ?? SOLDNER_BERLIN_PROJ4;
  const controlPoints = [];
  for (let xIndex = 0; xIndex < eastings.length; xIndex += 1) for (let yIndex = 0; yIndex < northings.length; yIndex += 1) {
    const pixel = intersection(vertical[xIndex], horizontal[yIndex]);
    controlPoints.push({
      label: `${eastings[xIndex]}_${northings[yIndex]}`,
      pixel: [pixel[0] + cropOrigin[0], pixel[1] + cropOrigin[1]],
      world: proj4(crs, "EPSG:4326", [eastings[xIndex], northings[yIndex]]),
    });
  }
  return {
    schemaVersion: "soldner-grid-controls-v1",
    image: { width: png.width, height: png.height, cropOrigin },
    crs,
    detection: {
      minimumCoverage: options.minimumCoverage ?? 0.2,
      verticalSpacingPx: verticalSelection.mean,
      verticalSpacingIrregularity: verticalSelection.irregularity,
      horizontalSpacingPx: horizontalSelection.mean,
      horizontalSpacingIrregularity: horizontalSelection.irregularity,
      vertical,
      horizontal,
    },
    controlPoints,
  };
}
