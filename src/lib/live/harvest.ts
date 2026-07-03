import type { Feature, FeatureCollection, LineString } from 'geojson';
import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from '../geo';
import { UNREACHED } from '../reach';
import type { LngLat, TravelMode } from '../types';
import type { StreetProps } from '../../map/geojson';
import type { TimeField } from './timeField';

/**
 * Harvests real street geometry from the Mapbox Streets vector tiles already
 * loaded for the basemap (composite source, "road" layer), and feeds it into
 * the exact same GeoJSON street source + paint expressions the mock uses.
 * Re-run on map idle (new tiles) and on origin/mode changes (new times).
 */

const MAJOR_CLASSES = new Set(['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link']);
// note: no 'service' — alleys/parking aisles would swamp the feature budget
const ROAD_CLASSES = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'secondary',
  'tertiary', 'street', 'street_limited', 'pedestrian', 'living_street', 'path',
]);
/** classes only meaningful on foot / by bike */
const SOFT_CLASSES = new Set(['path', 'pedestrian', 'living_street']);

const MAX_FEATURES = 14000;

function speedKmh(mode: TravelMode, major: boolean): number {
  switch (mode) {
    case 'walk':
    case 'transit':
      return 4.8;
    case 'cycle':
      return major ? 16 : 12.5;
    case 'drive':
      return major ? 30 : 14;
  }
}

interface QueryableMap {
  querySourceFeatures(sourceId: string, params: { sourceLayer: string }): Array<{
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown> | null;
  }>;
}

function lineLenKm(coords: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * KM_PER_DEG_LNG;
    const dy = (coords[i][1] - coords[i - 1][1]) * KM_PER_DEG_LAT;
    km += Math.sqrt(dx * dx + dy * dy);
  }
  return km;
}

/**
 * Pull road linework out of the currently loaded tiles, deduped across tiles,
 * limited to the (padded) viewport so the feature budget is spent where the
 * user is looking. Major roads are kept first so hitting the cap degrades to
 * "fewer alleys", never "missing arteries".
 */
export function harvestStreets(
  map: QueryableMap,
  mode: TravelMode,
  viewport: [number, number, number, number], // w, s, e, n
): FeatureCollection<LineString, StreetProps> {
  const padLng = (viewport[2] - viewport[0]) * 0.12;
  const padLat = (viewport[3] - viewport[1]) * 0.12;
  const w = viewport[0] - padLng;
  const s = viewport[1] - padLat;
  const e = viewport[2] + padLng;
  const n = viewport[3] + padLat;

  const raw = map.querySourceFeatures('composite', { sourceLayer: 'road' });
  const seen = new Set<string>();
  const majors: Feature<LineString, StreetProps>[] = [];
  const minors: Feature<LineString, StreetProps>[] = [];

  for (const f of raw) {
    const cls = String(f.properties?.class ?? '');
    if (!ROAD_CLASSES.has(cls)) continue;
    if (mode === 'drive' && SOFT_CLASSES.has(cls)) continue;

    const lines: LngLat[][] =
      f.geometry.type === 'LineString'
        ? [f.geometry.coordinates as LngLat[]]
        : f.geometry.type === 'MultiLineString'
          ? (f.geometry.coordinates as LngLat[][])
          : [];

    for (const coords of lines) {
      if (coords.length < 2) continue;
      const mid = coords[Math.floor(coords.length / 2)];
      if (mid[0] < w || mid[0] > e || mid[1] < s || mid[1] > n) continue;
      const a = coords[0];
      const b = coords[coords.length - 1];
      const key = `${cls}:${a[0].toFixed(5)},${a[1].toFixed(5)}:${b[0].toFixed(5)},${b[1].toFixed(5)}:${coords.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const major = MAJOR_CLASSES.has(cls);
      (major ? majors : minors).push({
        type: 'Feature',
        properties: {
          ta: UNREACHED,
          da: 1,
          tb: UNREACHED,
          db: 1,
          w: major ? 1.6 : 1,
          major: major ? 1 : 0,
          lenKm: lineLenKm(coords),
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }
  // over budget: stride-sample the minors so density thins evenly across the
  // whole viewport instead of entire districts going dark in tile order
  const minorBudget = Math.max(0, MAX_FEATURES - majors.length);
  let sampledMinors = minors;
  if (minors.length > minorBudget && minorBudget > 0) {
    sampledMinors = [];
    const stride = minors.length / minorBudget;
    for (let i = 0; i < minorBudget; i++) sampledMinors.push(minors[Math.floor(i * stride)]);
  }
  return { type: 'FeatureCollection', features: majors.concat(sampledMinors) };
}

/** Stamp reach times onto harvested streets from the active time field(s). */
export function assignStreetTimes(
  fc: FeatureCollection<LineString, StreetProps>,
  mode: TravelMode,
  fieldA: TimeField,
  fieldB: TimeField | null,
): void {
  for (const f of fc.features) {
    const coords = f.geometry.coordinates as LngLat[];
    const mid = coords[Math.floor(coords.length / 2)];
    const p = f.properties;
    const dur = Math.max(0.35, ((p.lenKm as number) / speedKmh(mode, p.major === 1)) * 60);
    p.ta = fieldA.timeAt(mid);
    p.da = dur;
    p.tb = fieldB ? fieldB.timeAt(mid) : UNREACHED;
    p.db = dur;
  }
}
