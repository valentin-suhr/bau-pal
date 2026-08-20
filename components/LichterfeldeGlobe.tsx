"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type GlobeGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

export type GlobeParcel = {
  id: string;
  geometry: GlobeGeometry;
  colour: string;
};

export type GlobeBuilding = {
  geometry: GlobeGeometry;
  storeys: number | null;
};

export type GlobePlanOutline = {
  planKey: string;
  geometry: GlobeGeometry;
};

type GlobeBounds = { west: number; east: number; south: number; north: number };

type GlobeProps = {
  parcels: GlobeParcel[];
  buildings: GlobeBuilding[];
  planOutlines: GlobePlanOutline[];
  selectedPlanKey: string | null;
  boundary: GlobeGeometry | null;
  bounds: GlobeBounds | null;
  geometryVersion: string;
  showBuildings: boolean;
  scale: number;
  resetKey: number;
  surfaceSpanRadians: number;
  onZoom: (factor: number) => void;
  onSelect: (id: string) => void;
  onSelectPlan: (planKey: string) => void;
};

type VectorLayer = {
  parcelMesh: THREE.Mesh | null;
  parcelMaterial: THREE.MeshBasicMaterial | null;
  outlines: THREE.LineSegments | null;
  outlineMaterial: THREE.LineBasicMaterial | null;
  buildings: THREE.Mesh | null;
  buildingMaterial: THREE.MeshStandardMaterial | null;
  ground: THREE.Mesh | null;
  groundMaterial: THREE.MeshStandardMaterial | null;
  groundOutline: THREE.LineSegments | null;
  groundOutlineMaterial: THREE.LineBasicMaterial | null;
  planOutlineObjects: THREE.LineSegments[];
  planOutlineMaterials: THREE.LineBasicMaterial[];
  parcelIdsByTriangle: string[];
};

type GlobeRuntime = VectorLayer & {
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  renderer: THREE.WebGLRenderer;
  targetRotation: { x: number; y: number };
};

const INITIAL_ROTATION = { x: -0.13, y: 0.2 };
const CROSS_SURFACE_SPAN_RADIANS = Math.PI * 0.86;
const PLAN_OUTLINE_RADIUS = 1.012;

function geometryRings(geometry: GlobeGeometry) {
  return geometry.type === "Polygon"
    ? [(geometry.coordinates as number[][][])[0]]
    : (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
}

function openRing(ring: number[][]) {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

function normalisedPoint(point: number[], bounds: GlobeBounds) {
  return {
    u: (point[0] - bounds.west) / Math.max(bounds.east - bounds.west, 0.000001),
    v: (bounds.north - point[1]) / Math.max(bounds.north - bounds.south, 0.000001),
  };
}

function spherePoint(u: number, v: number, radius: number, surfaceSpanRadians: number) {
  const longitude = (v - 0.5) * surfaceSpanRadians;
  const latitude = (u - 0.5) * CROSS_SURFACE_SPAN_RADIANS;
  const latitudeRadius = Math.cos(latitude);
  return new THREE.Vector3(
    radius * latitudeRadius * Math.sin(longitude),
    radius * Math.sin(latitude),
    radius * latitudeRadius * Math.cos(longitude),
  );
}

function addTriangle(target: number[], first: THREE.Vector3, second: THREE.Vector3, third: THREE.Vector3) {
  target.push(first.x, first.y, first.z, second.x, second.y, second.z, third.x, third.y, third.z);
}

function disposeVectorLayer(runtime: GlobeRuntime) {
  if (runtime.parcelMesh) {
    runtime.group.remove(runtime.parcelMesh);
    runtime.parcelMesh.geometry.dispose();
    runtime.parcelMaterial?.dispose();
  }
  if (runtime.outlines) {
    runtime.group.remove(runtime.outlines);
    runtime.outlines.geometry.dispose();
    runtime.outlineMaterial?.dispose();
  }
  if (runtime.buildings) {
    runtime.group.remove(runtime.buildings);
    runtime.buildings.geometry.dispose();
    runtime.buildingMaterial?.dispose();
  }
  if (runtime.ground) {
    runtime.group.remove(runtime.ground);
    runtime.ground.geometry.dispose();
    runtime.groundMaterial?.dispose();
  }
  if (runtime.groundOutline) {
    runtime.group.remove(runtime.groundOutline);
    runtime.groundOutline.geometry.dispose();
    runtime.groundOutlineMaterial?.dispose();
  }
  for (const outline of runtime.planOutlineObjects) {
    runtime.group.remove(outline);
    outline.geometry.dispose();
  }
  for (const material of runtime.planOutlineMaterials) material.dispose();
  runtime.parcelMesh = null;
  runtime.parcelMaterial = null;
  runtime.outlines = null;
  runtime.outlineMaterial = null;
  runtime.buildings = null;
  runtime.buildingMaterial = null;
  runtime.ground = null;
  runtime.groundMaterial = null;
  runtime.groundOutline = null;
  runtime.groundOutlineMaterial = null;
  runtime.planOutlineObjects = [];
  runtime.planOutlineMaterials = [];
  runtime.parcelIdsByTriangle = [];
}

function buildPlanOutlineGeometry(geometry: GlobeGeometry, bounds: GlobeBounds, surfaceSpanRadians: number) {
  const positions: number[] = [];
  for (const rawRing of geometryRings(geometry)) {
    const ring = openRing(rawRing);
    if (ring.length < 2) continue;
    for (let index = 0; index < ring.length; index += 1) {
      const current = normalisedPoint(ring[index], bounds);
      const next = normalisedPoint(ring[(index + 1) % ring.length], bounds);
      // Keep plan scopes just above parcel outlines to avoid z-fighting without
      // making them read as a separate layer floating above the neighbourhood.
      const first = spherePoint(current.u, current.v, PLAN_OUTLINE_RADIUS, surfaceSpanRadians);
      const second = spherePoint(next.u, next.v, PLAN_OUTLINE_RADIUS, surfaceSpanRadians);
      positions.push(first.x, first.y, first.z, second.x, second.y, second.z);
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  result.computeBoundingSphere();
  return result;
}

function buildParcelGeometry(parcels: GlobeParcel[], bounds: GlobeBounds, surfaceSpanRadians: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const outlinePositions: number[] = [];
  const parcelIdsByTriangle: string[] = [];

  for (const parcel of parcels) {
    const colour = new THREE.Color(parcel.colour);
    for (const rawRing of geometryRings(parcel.geometry)) {
      const ring = openRing(rawRing);
      if (ring.length < 3) continue;
      const contour = ring.map((point) => {
        const { u, v } = normalisedPoint(point, bounds);
        return new THREE.Vector2(u, v);
      });
      const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const triangle of triangles) {
        const vertices = triangle.map((vertexIndex) => {
          const point = contour[vertexIndex];
          return spherePoint(point.x, point.y, 1.006, surfaceSpanRadians);
        });
        addTriangle(positions, vertices[0], vertices[1], vertices[2]);
        for (const vertex of vertices) {
          const normal = vertex.clone().normalize();
          normals.push(normal.x, normal.y, normal.z);
          colours.push(colour.r, colour.g, colour.b);
        }
        parcelIdsByTriangle.push(parcel.id);
      }
      for (let index = 0; index < contour.length; index += 1) {
        const current = contour[index];
        const next = contour[(index + 1) % contour.length];
        const first = spherePoint(current.x, current.y, 1.008, surfaceSpanRadians);
        const second = spherePoint(next.x, next.y, 1.008, surfaceSpanRadians);
        outlinePositions.push(first.x, first.y, first.z, second.x, second.y, second.z);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();

  const outlines = new THREE.BufferGeometry();
  outlines.setAttribute("position", new THREE.Float32BufferAttribute(outlinePositions, 3));
  outlines.computeBoundingSphere();
  return { geometry, outlines, parcelIdsByTriangle };
}

function buildBuildingGeometry(buildings: GlobeBuilding[], bounds: GlobeBounds, surfaceSpanRadians: number) {
  const positions: number[] = [];
  const baseRadius = 1.006;

  for (const building of buildings) {
    const height = 0.004 + Math.min(8, Math.max(1, building.storeys ?? 2)) * 0.0032;
    const topRadius = baseRadius + height;
    for (const rawRing of geometryRings(building.geometry)) {
      const ring = openRing(rawRing);
      if (ring.length < 3) continue;
      const contour = ring.map((point) => {
        const { u, v } = normalisedPoint(point, bounds);
        return new THREE.Vector2(u, v);
      });
      const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const triangle of triangles) {
        const top = triangle.map((vertexIndex) => {
          const point = contour[vertexIndex];
          return spherePoint(point.x, point.y, topRadius, surfaceSpanRadians);
        });
        const bottom = triangle.map((vertexIndex) => {
          const point = contour[vertexIndex];
          return spherePoint(point.x, point.y, baseRadius, surfaceSpanRadians);
        });
        // Roof and reversed underside caps make every radial extrusion watertight.
        addTriangle(positions, top[0], top[1], top[2]);
        addTriangle(positions, bottom[2], bottom[1], bottom[0]);
      }
      for (let index = 0; index < contour.length; index += 1) {
        const current = contour[index];
        const next = contour[(index + 1) % contour.length];
        const lowerFirst = spherePoint(current.x, current.y, baseRadius, surfaceSpanRadians);
        const lowerSecond = spherePoint(next.x, next.y, baseRadius, surfaceSpanRadians);
        const upperFirst = spherePoint(current.x, current.y, topRadius, surfaceSpanRadians);
        const upperSecond = spherePoint(next.x, next.y, topRadius, surfaceSpanRadians);
        addTriangle(positions, lowerFirst, lowerSecond, upperFirst);
        addTriangle(positions, lowerSecond, upperSecond, upperFirst);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildGroundGeometry(boundary: GlobeGeometry, bounds: GlobeBounds, surfaceSpanRadians: number) {
  const positions: number[] = [];
  const outlinePositions: number[] = [];
  const topRadius = 1.004;
  const bottomRadius = 1.001;
  for (const rawRing of geometryRings(boundary)) {
    const ring = openRing(rawRing);
    if (ring.length < 3) continue;
    const contour = ring.map((point) => {
      const { u, v } = normalisedPoint(point, bounds);
      return new THREE.Vector2(u, v);
    });
    for (const triangle of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const top = triangle.map((vertexIndex) => {
        const point = contour[vertexIndex];
        return spherePoint(point.x, point.y, topRadius, surfaceSpanRadians);
      });
      addTriangle(positions, top[0], top[1], top[2]);
    }
    for (let index = 0; index < contour.length; index += 1) {
      const current = contour[index];
      const next = contour[(index + 1) % contour.length];
      const lowerFirst = spherePoint(current.x, current.y, bottomRadius, surfaceSpanRadians);
      const lowerSecond = spherePoint(next.x, next.y, bottomRadius, surfaceSpanRadians);
      const upperFirst = spherePoint(current.x, current.y, topRadius, surfaceSpanRadians);
      const upperSecond = spherePoint(next.x, next.y, topRadius, surfaceSpanRadians);
      addTriangle(positions, lowerFirst, lowerSecond, upperFirst);
      addTriangle(positions, lowerSecond, upperSecond, upperFirst);
      const outlineFirst = spherePoint(current.x, current.y, 1.009, surfaceSpanRadians);
      const outlineSecond = spherePoint(next.x, next.y, 1.009, surfaceSpanRadians);
      outlinePositions.push(outlineFirst.x, outlineFirst.y, outlineFirst.z, outlineSecond.x, outlineSecond.y, outlineSecond.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const outline = new THREE.BufferGeometry();
  outline.setAttribute("position", new THREE.Float32BufferAttribute(outlinePositions, 3));
  outline.computeBoundingSphere();
  return { geometry, outline };
}

export default function LichterfeldeGlobe({ parcels, buildings, planOutlines, selectedPlanKey, boundary, bounds, geometryVersion, showBuildings, scale, resetKey, surfaceSpanRadians, onZoom, onSelect, onSelectPlan }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GlobeRuntime | null>(null);
  const zoomHandlerRef = useRef(onZoom);
  const selectHandlerRef = useRef(onSelect);
  const selectPlanHandlerRef = useRef(onSelectPlan);

  useEffect(() => { zoomHandlerRef.current = onZoom; }, [onZoom]);
  useEffect(() => { selectHandlerRef.current = onSelect; }, [onSelect]);
  useEffect(() => { selectPlanHandlerRef.current = onSelectPlan; }, [onSelectPlan]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 3.2);

    const group = new THREE.Group();
    group.rotation.set(INITIAL_ROTATION.x, INITIAL_ROTATION.y, -Math.PI / 2);
    scene.add(group);

    const sphereGeometry = new THREE.SphereGeometry(1, 96, 72);
    const sphereMaterial = new THREE.MeshPhysicalMaterial({ color: 0xddeaf7, roughness: 0.72, clearcoat: 0.18, transparent: true, opacity: 0.96 });
    group.add(new THREE.Mesh(sphereGeometry, sphereMaterial));

    scene.add(new THREE.HemisphereLight(0xffffff, 0x7196ba, 2.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(-3.5, 4.5, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x83bfff, 1.35);
    rimLight.position.set(4, -2, -3);
    scene.add(rimLight);

    const targetRotation = { ...INITIAL_ROTATION };
    const runtime: GlobeRuntime = {
      camera, group, renderer, targetRotation,
      parcelMesh: null, parcelMaterial: null, outlines: null, outlineMaterial: null,
      buildings: null, buildingMaterial: null, ground: null, groundMaterial: null,
      groundOutline: null, groundOutlineMaterial: null, parcelIdsByTriangle: [],
      planOutlineObjects: [], planOutlineMaterials: [],
    };
    runtimeRef.current = runtime;

    let dragging = false;
    let moved = 0;
    let pointerX = 0;
    let pointerY = 0;
    const pointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = 0;
      pointerX = event.clientX;
      pointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
    };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - pointerX;
      const dy = event.clientY - pointerY;
      moved += Math.abs(dx) + Math.abs(dy);
      targetRotation.y += dx * 0.007;
      targetRotation.x += dy * 0.007;
      pointerX = event.clientX;
      pointerY = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => {
      dragging = false;
      canvas.classList.remove("dragging");
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (moved > 5 || !runtime.parcelMesh) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.params.Line.threshold = 0.025;
      raycaster.setFromCamera(pointer, camera);
      const planHit = raycaster.intersectObjects(runtime.planOutlineObjects, false)[0];
      const planKey = planHit?.object.userData.planKey;
      if (typeof planKey === "string") {
        selectPlanHandlerRef.current(planKey);
        return;
      }
      const hit = raycaster.intersectObject(runtime.parcelMesh, false)[0];
      if (hit?.faceIndex != null) {
        const parcelId = runtime.parcelIdsByTriangle[hit.faceIndex];
        if (parcelId) selectHandlerRef.current(parcelId);
      }
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomHandlerRef.current(event.deltaY > 0 ? 1.12 : 0.88);
    };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frame = 0;
    const render = () => {
      group.rotation.x += (targetRotation.x - group.rotation.x) * 0.11;
      group.rotation.y += (targetRotation.y - group.rotation.y) * 0.11;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      disposeVectorLayer(runtime);
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      renderer.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !bounds || !boundary || parcels.length === 0) return;
    disposeVectorLayer(runtime);

    const groundGeometry = buildGroundGeometry(boundary, bounds, surfaceSpanRadians);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xb8d5bd, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeometry.geometry, groundMaterial);
    runtime.group.add(ground);

    const groundOutlineMaterial = new THREE.LineBasicMaterial({ color: 0x4f8160, transparent: true, opacity: 0.95 });
    const groundOutline = new THREE.LineSegments(groundGeometry.outline, groundOutlineMaterial);
    runtime.group.add(groundOutline);

    const parcelLayer = buildParcelGeometry(parcels, bounds, surfaceSpanRadians);
    const parcelMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    const parcelMesh = new THREE.Mesh(parcelLayer.geometry, parcelMaterial);
    runtime.group.add(parcelMesh);

    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 });
    const outlines = new THREE.LineSegments(parcelLayer.outlines, outlineMaterial);
    runtime.group.add(outlines);

    const buildingGeometry = buildBuildingGeometry(showBuildings ? buildings : [], bounds, surfaceSpanRadians);
    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xf9fbfe, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    const buildingMesh = new THREE.Mesh(buildingGeometry, buildingMaterial);
    runtime.group.add(buildingMesh);

    const planOutlineObjects = planOutlines.map((plan) => {
      const material = new THREE.LineBasicMaterial({ color: 0x6f45c9, transparent: true, opacity: 0.95 });
      const outline = new THREE.LineSegments(buildPlanOutlineGeometry(plan.geometry, bounds, surfaceSpanRadians), material);
      outline.userData.planKey = plan.planKey;
      runtime.group.add(outline);
      runtime.planOutlineMaterials.push(material);
      return outline;
    });

    runtime.parcelMesh = parcelMesh;
    runtime.parcelMaterial = parcelMaterial;
    runtime.outlines = outlines;
    runtime.outlineMaterial = outlineMaterial;
    runtime.buildings = buildingMesh;
    runtime.buildingMaterial = buildingMaterial;
    runtime.ground = ground;
    runtime.groundMaterial = groundMaterial;
    runtime.groundOutline = groundOutline;
    runtime.groundOutlineMaterial = groundOutlineMaterial;
    runtime.planOutlineObjects = planOutlineObjects;
    runtime.parcelIdsByTriangle = parcelLayer.parcelIdsByTriangle;
  }, [boundary, bounds, buildings, geometryVersion, planOutlines, showBuildings, surfaceSpanRadians]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.planOutlineObjects.forEach((outline, index) => {
      const selected = outline.userData.planKey === selectedPlanKey;
      const material = runtime.planOutlineMaterials[index];
      material.color.setHex(selected ? 0x3e1a8f : 0x6f45c9);
      material.opacity = selected ? 1 : 0.88;
    });
  }, [selectedPlanKey]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.parcelMesh || runtime.parcelIdsByTriangle.length === 0) return;
    const attribute = runtime.parcelMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const colours = new Map(parcels.map((parcel) => [parcel.id, new THREE.Color(parcel.colour)]));
    runtime.parcelIdsByTriangle.forEach((parcelId, triangleIndex) => {
      const colour = colours.get(parcelId);
      if (!colour) return;
      const vertex = triangleIndex * 3;
      attribute.setXYZ(vertex, colour.r, colour.g, colour.b);
      attribute.setXYZ(vertex + 1, colour.r, colour.g, colour.b);
      attribute.setXYZ(vertex + 2, colour.r, colour.g, colour.b);
    });
    attribute.needsUpdate = true;
  }, [parcels]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.camera.position.z = 3.2 * Math.sqrt(1.8 / scale);
    runtime.camera.updateProjectionMatrix();
  }, [scale]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.targetRotation.x = INITIAL_ROTATION.x;
    runtime.targetRotation.y = INITIAL_ROTATION.y;
  }, [resetKey]);

  return <canvas ref={canvasRef} className="globe-canvas" tabIndex={0} aria-label="Rotatable vector 3D model of Lichterfelde parcels and buildings" />;
}
