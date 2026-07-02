import {
  distToPolylineKm,
  pointInRing,
  ribbonAround,
  roundedRect,
  KM_PER_DEG_LAT,
  KM_PER_DEG_LNG,
} from '../geo';
import { hashNoise } from '../rng';
import type { CityModel, LngLat, StreetEdge } from '../types';
import { EDGE_BRIDGE, EDGE_MAJOR, EDGE_MINOR } from '../types';

// Demo coverage: central London.
const LNG_MIN = -0.235;
const LNG_MAX = 0.02;
const LAT_MIN = 51.452;
const LAT_MAX = 51.568;

// ~230 m grid pitch before warping.
const COL_STEP = 0.00335;
const ROW_STEP = 0.0021;

/** The Thames, hand-traced through central London (approximate, mock data). */
export const THAMES: LngLat[] = [
  [-0.245, 51.468],
  [-0.211, 51.4665],
  [-0.19, 51.4705],
  [-0.178, 51.4765],
  [-0.166, 51.4815],
  [-0.152, 51.4845],
  [-0.136, 51.4855],
  [-0.1295, 51.487],
  [-0.124, 51.4895],
  [-0.1215, 51.4935],
  [-0.12, 51.4985],
  [-0.1175, 51.503],
  [-0.1135, 51.5065],
  [-0.1075, 51.5095],
  [-0.0985, 51.5105],
  [-0.0925, 51.5095],
  [-0.0865, 51.5075],
  [-0.078, 51.5055],
  [-0.0705, 51.5045],
  [-0.0615, 51.5055],
  [-0.053, 51.508],
  [-0.045, 51.5085],
  [-0.036, 51.506],
  [-0.0315, 51.5],
  [-0.03, 51.493],
  [-0.0265, 51.4875],
  [-0.0185, 51.484],
  [-0.009, 51.4835],
  [-0.0025, 51.487],
  [0.002, 51.494],
  [0.004, 51.502],
  [0.008, 51.507],
  [0.015, 51.5085],
  [0.025, 51.508],
];

const RIVER_HALF_KM = 0.16;

/** lng positions where a bridge crosses the river */
const BRIDGES = [-0.205, -0.19, -0.178, -0.166, -0.146, -0.1355, -0.1245, -0.1215, -0.116, -0.1125, -0.1035, -0.0945, -0.0877, -0.0755];

const PARKS: Array<[number, number, number, number]> = [
  [-0.201, 51.5025, -0.152, 51.5125], // Hyde Park + Kensington Gardens
  [-0.1635, 51.5215, -0.1435, 51.535], // Regent's Park
  [-0.1505, 51.501, -0.128, 51.5075], // St James's + Green Park
  [-0.163, 51.475, -0.147, 51.4815], // Battersea Park
  [-0.162, 51.4525, -0.138, 51.4625], // Clapham Common
  [-0.095, 51.4835, -0.075, 51.489], // Burgess Park
  [-0.048, 51.532, -0.028, 51.541], // Victoria Park
];

/** smooth organic warp so the lattice doesn't read as graph paper */
function warp(lng: number, lat: number): LngLat {
  const u = (lng - LNG_MIN) / (LNG_MAX - LNG_MIN);
  const v = (lat - LAT_MIN) / (LAT_MAX - LAT_MIN);
  const dLng =
    0.0011 * Math.sin(u * 9.2 + v * 3.1) +
    0.0007 * Math.sin(v * 14.7 + 1.3) +
    0.0005 * Math.sin(u * 23.0 + v * 11.0 + 4.0);
  const dLat =
    0.0007 * Math.sin(v * 8.4 + u * 4.7 + 2.1) +
    0.00045 * Math.sin(u * 17.3 + 0.6) +
    0.0003 * Math.sin(v * 26.0 + u * 9.0);
  return [lng + dLng, lat + dLat];
}

export function buildCity(): CityModel {
  const cols = Math.round((LNG_MAX - LNG_MIN) / COL_STEP) + 1;
  const rows = Math.round((LAT_MAX - LAT_MIN) / ROW_STEP) + 1;

  const riverRing = ribbonAround(THAMES, RIVER_HALF_KM);
  const parkRings = PARKS.map(([a, b, c, d]) => roundedRect(a, b, c, d, 0.35));

  const idOf = new Int32Array(cols * rows).fill(-1);
  const nodes: LngLat[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const baseLng = LNG_MIN + c * COL_STEP;
      const baseLat = LAT_MIN + r * ROW_STEP;
      let [lng, lat] = warp(baseLng, baseLat);
      lng += hashNoise(c, r, 11) * COL_STEP * 0.24;
      lat += hashNoise(c, r, 29) * ROW_STEP * 0.24;
      const p: LngLat = [lng, lat];

      if (distToPolylineKm(p, THAMES) < RIVER_HALF_KM + 0.05) continue;
      if (parkRings.some((ring) => pointInRing(p, ring))) continue;
      // ragged outer boundary so the demo area doesn't end in a hard rectangle
      const edgeFade =
        Math.min(c, cols - 1 - c) < 3 || Math.min(r, rows - 1 - r) < 2
          ? hashNoise(c, r, 47) > -0.2
          : false;
      if (edgeFade) continue;

      idOf[r * cols + c] = nodes.length;
      nodes.push(p);
    }
  }

  const edges: StreetEdge[] = [];
  const majorCol = (c: number) => c % 6 === 2;
  const majorRow = (r: number) => r % 5 === 1;

  const pushEdge = (i: number, j: number, kind: number) => {
    const a = nodes[i];
    const b = nodes[j];
    const dx = (a[0] - b[0]) * KM_PER_DEG_LNG;
    const dy = (a[1] - b[1]) * KM_PER_DEG_LAT;
    edges.push({ a: i, b: j, kind, lenKm: Math.sqrt(dx * dx + dy * dy) });
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = idOf[r * cols + c];
      if (id < 0) continue;
      // occasional missing links keep the fabric irregular
      const right = c + 1 < cols ? idOf[r * cols + c + 1] : -1;
      const up = r + 1 < rows ? idOf[(r + 1) * cols + c] : -1;
      if (right >= 0 && hashNoise(c, r, 71) > -0.86) {
        pushEdge(id, right, majorRow(r) ? EDGE_MAJOR : EDGE_MINOR);
      }
      if (up >= 0 && hashNoise(c, r, 97) > -0.86) {
        pushEdge(id, up, majorCol(c) ? EDGE_MAJOR : EDGE_MINOR);
      }
      // sparse diagonals for organic shortcuts
      const diag = c + 1 < cols && r + 1 < rows ? idOf[(r + 1) * cols + c + 1] : -1;
      if (diag >= 0 && hashNoise(c, r, 131) > 0.82) pushEdge(id, diag, EDGE_MINOR);
    }
  }

  // Bridges: stitch nearest north/south banks back together at known crossings.
  for (const bLng of BRIDGES) {
    if (bLng < LNG_MIN + 0.004 || bLng > LNG_MAX - 0.004) continue;
    // find river latitude at this lng
    let riverLat = 51.5;
    let best = Infinity;
    for (const [tl, tt] of THAMES) {
      const d = Math.abs(tl - bLng);
      if (d < best) {
        best = d;
        riverLat = tt;
      }
    }
    let north = -1, south = -1, dn = Infinity, ds = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const [lng, lat] = nodes[i];
      const dx = Math.abs(lng - bLng);
      if (dx > 0.004) continue;
      const dLat = lat - riverLat;
      const cost = dx * 2 + Math.abs(dLat);
      if (dLat > 0 && cost < dn) { dn = cost; north = i; }
      if (dLat < 0 && cost < ds) { ds = cost; south = i; }
    }
    if (north >= 0 && south >= 0) pushEdge(north, south, EDGE_BRIDGE);
  }

  const adj: Array<Array<[number, number]>> = nodes.map(() => []);
  edges.forEach((e, idx) => {
    adj[e.a].push([idx, e.b]);
    adj[e.b].push([idx, e.a]);
  });

  const cellAreaKm2 = COL_STEP * KM_PER_DEG_LNG * (ROW_STEP * KM_PER_DEG_LAT);

  return {
    nodes: nodes.map(([x, y]) => ({ x, y })),
    edges,
    adj,
    riverRing,
    parkRings,
    bbox: [LNG_MIN, LAT_MIN, LNG_MAX, LAT_MAX],
    cellAreaKm2,
  };
}

export function nearestNode(city: CityModel, p: LngLat): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < city.nodes.length; i++) {
    const dx = (city.nodes[i].x - p[0]) * KM_PER_DEG_LNG;
    const dy = (city.nodes[i].y - p[1]) * KM_PER_DEG_LAT;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** distance in km from a point to the closest street node */
export function distToNetworkKm(city: CityModel, p: LngLat): number {
  const n = nearestNode(city, p);
  if (n < 0) return Infinity;
  const dx = (city.nodes[n].x - p[0]) * KM_PER_DEG_LNG;
  const dy = (city.nodes[n].y - p[1]) * KM_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}
