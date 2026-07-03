import { N_SPOKES, profileAt, ringFromProfile, type Profile } from '../bands';
import { ringAreaKm2, KM_PER_DEG_LAT, KM_PER_DEG_LNG } from '../geo';
import { UNREACHED } from '../reach';
import type { LngLat, TubeNetwork } from '../types';

/**
 * A TimeField answers "how many minutes to reach this point?" for one origin.
 * It's the live-data replacement for per-edge Dijkstra times: street segments
 * harvested from vector tiles get their reach time by sampling the field.
 */
export interface TimeField {
  timeAt(p: LngLat): number; // minutes, UNREACHED if outside
  /** cumulative km² reachable at each whole minute 0..60 (for the area stat) */
  areaByMinute(): Float32Array;
  /** frontier ring at time t, or null if the field has no meaningful ring */
  frontierRing(t: number): LngLat[] | null;
}

/**
 * Radial field from provider isochrone bands (drive / walk / cycle).
 * Bands -> radial profiles; a point's time is found by locating its distance
 * between the two adjacent band radii along its bearing and interpolating —
 * the same 1-minute interpolation the frontier ring uses.
 */
export function radialField(origin: LngLat, bandMinutes: number[], profiles: Profile[]): TimeField {
  const radiusAt = (profile: Profile, angle: number): number => {
    const a = ((angle / (2 * Math.PI)) * N_SPOKES + N_SPOKES) % N_SPOKES;
    const i0 = Math.floor(a) % N_SPOKES;
    const i1 = (i0 + 1) % N_SPOKES;
    const f = a - Math.floor(a);
    return profile[i0] * (1 - f) + profile[i1] * f;
  };

  return {
    timeAt(p: LngLat): number {
      const dx = (p[0] - origin[0]) * KM_PER_DEG_LNG;
      const dy = (p[1] - origin[1]) * KM_PER_DEG_LAT;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      let prevT = 0;
      let prevR = 0;
      for (let b = 0; b < bandMinutes.length; b++) {
        const r = radiusAt(profiles[b], angle);
        if (dist <= r) {
          const f = r === prevR ? 1 : (dist - prevR) / (r - prevR);
          return prevT + (bandMinutes[b] - prevT) * Math.max(0, Math.min(1, f));
        }
        prevT = bandMinutes[b];
        prevR = r;
      }
      return UNREACHED;
    },
    areaByMinute(): Float32Array {
      const area = new Float32Array(61);
      for (let m = 1; m <= 60; m++) {
        area[m] = ringAreaKm2(ringFromProfile(origin, profileAt(bandMinutes, profiles, m)));
      }
      return area;
    },
    frontierRing(t: number): LngLat[] {
      return ringFromProfile(origin, profileAt(bandMinutes, profiles, t));
    },
  };
}

const WALK_KMH = 4.8;
/** straight-line to street-network detour correction */
const DETOUR = 1.35;

const walkMinutes = (a: LngLat, b: LngLat): number => {
  const dx = (a[0] - b[0]) * KM_PER_DEG_LNG;
  const dy = (a[1] - b[1]) * KM_PER_DEG_LAT;
  return ((Math.sqrt(dx * dx + dy * dy) * DETOUR) / WALK_KMH) * 60;
};

/**
 * Multi-centre transit field: a point is reached either by walking straight
 * from the origin, or by riding to any station and walking out from it —
 * whichever is fastest. This is what makes the street colouring bloom around
 * each station as the wave arrives.
 */
export function transitField(
  origin: LngLat,
  tube: TubeNetwork,
  stationMinutes: Float32Array,
  /** area sampling window (lngMin, latMin, lngMax, latMax) */
  bbox: [number, number, number, number],
): TimeField {
  const centres: Array<{ pos: LngLat; t: number }> = [{ pos: origin, t: 0 }];
  tube.stations.forEach((s, i) => {
    if (stationMinutes[i] < UNREACHED) centres.push({ pos: s.pos, t: stationMinutes[i] });
  });

  const timeAt = (p: LngLat): number => {
    let best = UNREACHED;
    for (const c of centres) {
      const t = c.t + walkMinutes(c.pos, p);
      if (t < best) best = t;
    }
    return best;
  };

  return {
    timeAt,
    areaByMinute(): Float32Array {
      // sample a grid once; each cell contributes its area at its reach minute
      const [lngMin, latMin, lngMax, latMax] = bbox;
      const NX = 88;
      const NY = 64;
      const cellKm2 =
        (((lngMax - lngMin) / NX) * KM_PER_DEG_LNG) * (((latMax - latMin) / NY) * KM_PER_DEG_LAT);
      const area = new Float32Array(61);
      for (let iy = 0; iy < NY; iy++) {
        for (let ix = 0; ix < NX; ix++) {
          const t = timeAt([lngMin + ((ix + 0.5) / NX) * (lngMax - lngMin), latMin + ((iy + 0.5) / NY) * (latMax - latMin)]);
          const bin = Math.ceil(t);
          if (bin <= 60) area[Math.max(0, bin)] += cellKm2;
        }
      }
      for (let m = 1; m <= 60; m++) area[m] += area[m - 1];
      return area;
    },
    frontierRing(): null {
      return null; // multi-centre reach has no single ring
    },
  };
}
