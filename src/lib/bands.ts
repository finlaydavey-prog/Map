import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from './geo';
import { UNREACHED } from './reach';
import type { CityModel, IsochroneBand, LngLat } from './types';

export const N_SPOKES = 144;

/**
 * Radial reachability profile: for each of N_SPOKES angle bins around the
 * origin, the furthest reached distance (km). Contour rings <-> profiles is
 * how the app interpolates a smooth 1-minute frontier from coarse API bands.
 */
export type Profile = Float32Array<ArrayBufferLike>;

function smoothCircular(p: Profile, passes = 2): Profile {
  let cur = p;
  for (let k = 0; k < passes; k++) {
    const out = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      const a = cur[(i - 1 + cur.length) % cur.length];
      const b = cur[i];
      const c = cur[(i + 1) % cur.length];
      out[i] = (a + 2 * b + c) / 4;
    }
    cur = out;
  }
  return cur;
}

/** Build one profile per band directly from graph reach times (mock provider). */
export function profilesFromReach(
  city: CityModel,
  origin: LngLat,
  nodeMin: Float32Array,
  bandMinutes: number[],
): Profile[] {
  const profiles: Profile[] = bandMinutes.map(() => new Float32Array(N_SPOKES));
  for (let i = 0; i < city.nodes.length; i++) {
    const t = nodeMin[i];
    if (t >= UNREACHED) continue;
    const dx = (city.nodes[i].x - origin[0]) * KM_PER_DEG_LNG;
    const dy = (city.nodes[i].y - origin[1]) * KM_PER_DEG_LAT;
    const r = Math.sqrt(dx * dx + dy * dy);
    const bin = ((Math.round((Math.atan2(dy, dx) / (2 * Math.PI)) * N_SPOKES) % N_SPOKES) + N_SPOKES) % N_SPOKES;
    for (let b = 0; b < bandMinutes.length; b++) {
      if (t <= bandMinutes[b] && r > profiles[b][bin]) profiles[b][bin] = r;
    }
  }
  return profiles.map((p, b) => {
    // fill empty bins from neighbours so gaps (river, parks) don't collapse the ring
    const filled = new Float32Array(p);
    for (let i = 0; i < N_SPOKES; i++) {
      if (filled[i] > 0) continue;
      for (let step = 1; step < N_SPOKES / 2; step++) {
        const l = p[(i - step + N_SPOKES) % N_SPOKES];
        const r = p[(i + step) % N_SPOKES];
        if (l > 0 || r > 0) {
          filled[i] = Math.max(l, r) * Math.max(0.4, 1 - step * 0.12);
          break;
        }
      }
    }
    const smoothed = smoothCircular(filled, 3);
    // keep bands nested
    if (b > 0) {
      const prev = profiles[b - 1];
      for (let i = 0; i < N_SPOKES; i++) smoothed[i] = Math.max(smoothed[i], prev[i]);
    }
    profiles[b] = smoothed;
    return smoothed;
  });
}

/** Convert provider rings back into radial profiles (used with real APIs too). */
export function profilesFromRings(origin: LngLat, bands: IsochroneBand[]): Profile[] {
  return bands.map((band) => {
    const p = new Float32Array(N_SPOKES);
    for (const [lng, lat] of band.ring) {
      const dx = (lng - origin[0]) * KM_PER_DEG_LNG;
      const dy = (lat - origin[1]) * KM_PER_DEG_LAT;
      const r = Math.sqrt(dx * dx + dy * dy);
      const bin = ((Math.round((Math.atan2(dy, dx) / (2 * Math.PI)) * N_SPOKES) % N_SPOKES) + N_SPOKES) % N_SPOKES;
      if (r > p[bin]) p[bin] = r;
    }
    // fill + smooth
    for (let i = 0; i < N_SPOKES; i++) {
      if (p[i] === 0) {
        const l = p[(i - 1 + N_SPOKES) % N_SPOKES];
        const r = p[(i + 1) % N_SPOKES];
        p[i] = Math.max(l, r) * 0.95;
      }
    }
    return smoothCircular(p, 2);
  });
}

export function ringFromProfile(origin: LngLat, profile: Profile, scale = 1): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i < N_SPOKES; i++) {
    const a = (i / N_SPOKES) * 2 * Math.PI;
    const r = Math.max(0.06, profile[i] * scale);
    ring.push([
      origin[0] + (Math.cos(a) * r) / KM_PER_DEG_LNG,
      origin[1] + (Math.sin(a) * r) / KM_PER_DEG_LAT,
    ]);
  }
  return ring;
}

/**
 * The 1-minute trick: bands are fetched at coarse intervals; the frontier for
 * any fractional minute is a lerp between the two adjacent band profiles.
 */
export function profileAt(bandMinutes: number[], profiles: Profile[], t: number): Profile {
  const out = new Float32Array(N_SPOKES);
  if (profiles.length === 0) return out;
  if (t <= bandMinutes[0]) {
    const k = Math.max(0.02, t / bandMinutes[0]);
    for (let i = 0; i < N_SPOKES; i++) out[i] = profiles[0][i] * k;
    return out;
  }
  let b = 0;
  while (b < bandMinutes.length - 1 && bandMinutes[b + 1] < t) b++;
  if (b >= bandMinutes.length - 1) return profiles[profiles.length - 1];
  const f = (t - bandMinutes[b]) / (bandMinutes[b + 1] - bandMinutes[b]);
  const lo = profiles[b];
  const hi = profiles[b + 1];
  for (let i = 0; i < N_SPOKES; i++) out[i] = lo[i] + (hi[i] - lo[i]) * f;
  return out;
}
