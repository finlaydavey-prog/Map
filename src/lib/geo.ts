import type { LngLat } from './types';

/** km per degree at London's latitude */
export const KM_PER_DEG_LAT = 110.9;
export const KM_PER_DEG_LNG = 69.3;

export function distKm(a: LngLat, b: LngLat): number {
  const dx = (a[0] - b[0]) * KM_PER_DEG_LNG;
  const dy = (a[1] - b[1]) * KM_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/** distance (km) from point p to segment [a, b] */
export function distToSegmentKm(p: LngLat, a: LngLat, b: LngLat): number {
  const ax = a[0] * KM_PER_DEG_LNG, ay = a[1] * KM_PER_DEG_LAT;
  const bx = b[0] * KM_PER_DEG_LNG, by = b[1] * KM_PER_DEG_LAT;
  const px = p[0] * KM_PER_DEG_LNG, py = p[1] * KM_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/** distance (km) from point to polyline */
export function distToPolylineKm(p: LngLat, line: LngLat[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = distToSegmentKm(p, line[i], line[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Build a closed ribbon polygon around a polyline (constant half-width in km). */
export function ribbonAround(line: LngLat[], halfWidthKm: number): LngLat[] {
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    let nx = -(next[1] - prev[1]) * KM_PER_DEG_LAT;
    let ny = (next[0] - prev[0]) * KM_PER_DEG_LNG;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nl;
    ny /= nl;
    left.push([line[i][0] + (nx * halfWidthKm) / KM_PER_DEG_LNG, line[i][1] + (ny * halfWidthKm) / KM_PER_DEG_LAT]);
    right.push([line[i][0] - (nx * halfWidthKm) / KM_PER_DEG_LNG, line[i][1] - (ny * halfWidthKm) / KM_PER_DEG_LAT]);
  }
  return [...left, ...right.reverse()];
}

/** Rounded-rectangle polygon, for organic-ish park shapes. */
export function roundedRect(
  lngMin: number,
  latMin: number,
  lngMax: number,
  latMax: number,
  cornerFrac = 0.3,
): LngLat[] {
  const w = lngMax - lngMin;
  const h = latMax - latMin;
  const r = Math.min(w, h) * cornerFrac;
  const cx = [lngMin + r, lngMax - r];
  const cy = [latMin + r * (KM_PER_DEG_LNG / KM_PER_DEG_LAT), latMax - r * (KM_PER_DEG_LNG / KM_PER_DEG_LAT)];
  const ry = r * (KM_PER_DEG_LNG / KM_PER_DEG_LAT);
  const pts: LngLat[] = [];
  const corner = (ccx: number, ccy: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * ry]);
    }
  };
  corner(cx[1], cy[1], 0);
  corner(cx[0], cy[1], Math.PI / 2);
  corner(cx[0], cy[0], Math.PI);
  corner(cx[1], cy[0], (3 * Math.PI) / 2);
  return pts;
}

export function pointInRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** polygon area in km² (shoelace, local-km projection) */
export function ringAreaKm2(ring: LngLat[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * KM_PER_DEG_LNG, yi = ring[i][1] * KM_PER_DEG_LAT;
    const xj = ring[j][0] * KM_PER_DEG_LNG, yj = ring[j][1] * KM_PER_DEG_LAT;
    s += xj * yi - xi * yj;
  }
  return Math.abs(s) / 2;
}
