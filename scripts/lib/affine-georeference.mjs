const EARTH_RADIUS_M = 6_371_008.8;

function solve3(matrix, values) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row += 1) if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    if (Math.abs(augmented[pivot][pivot]) < 1e-12) throw new Error("Control points do not define a stable affine transform");
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column < 4; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column < 4; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }
  return augmented.map((row) => row[3]);
}

function fitAxis(controlPoints, worldIndex) {
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const target = [0, 0, 0];
  for (const point of controlPoints) {
    const row = [point.pixel[0], point.pixel[1], 1];
    for (let i = 0; i < 3; i += 1) {
      target[i] += row[i] * point.world[worldIndex];
      for (let j = 0; j < 3; j += 1) normal[i][j] += row[i] * row[j];
    }
  }
  return solve3(normal, target);
}

function haversineMetres(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLng = (b[0] - a[0]) * radians;
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fitAffineTransform(controlPoints) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 3) throw new Error("At least three control points are required");
  for (const [index, point] of controlPoints.entries()) {
    if (!Array.isArray(point.pixel) || point.pixel.length !== 2 || !point.pixel.every(Number.isFinite)) throw new Error(`Invalid pixel coordinate at control point ${index}`);
    if (!Array.isArray(point.world) || point.world.length !== 2 || !point.world.every(Number.isFinite)) throw new Error(`Invalid world coordinate at control point ${index}`);
  }
  const longitude = fitAxis(controlPoints, 0);
  const latitude = fitAxis(controlPoints, 1);
  const transform = (pixel) => [
    longitude[0] * pixel[0] + longitude[1] * pixel[1] + longitude[2],
    latitude[0] * pixel[0] + latitude[1] * pixel[1] + latitude[2],
  ];
  const residualsMetres = controlPoints.map((point) => haversineMetres(transform(point.pixel), point.world));
  const rmsResidualMetres = Math.sqrt(residualsMetres.reduce((sum, value) => sum + value ** 2, 0) / residualsMetres.length);
  return {
    coefficients: { longitude, latitude },
    transform,
    qa: {
      controlPointCount: controlPoints.length,
      residualsMetres,
      rmsResidualMetres,
      maxResidualMetres: Math.max(...residualsMetres),
    },
  };
}

function mapCoordinates(coordinates, depth, transform) {
  if (depth === 0) return transform(coordinates);
  return coordinates.map((coordinate) => mapCoordinates(coordinate, depth - 1, transform));
}

const coordinateDepth = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

export function transformGeometry(geometry, transform) {
  if (!geometry || !(geometry.type in coordinateDepth)) throw new Error(`Unsupported geometry type: ${geometry?.type ?? "missing"}`);
  return { ...geometry, coordinates: mapCoordinates(geometry.coordinates, coordinateDepth[geometry.type], transform) };
}

export function geometryBbox(geometry) {
  const points = [];
  const visit = (value) => {
    if (Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite)) points.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  if (!points.length) throw new Error("Geometry has no coordinates");
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
  ];
}
