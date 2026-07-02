import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { UNREACHED } from '../lib/reach';
import type { CityModel, TubeNetwork } from '../lib/types';
import { EDGE_MINOR } from '../lib/types';

export interface StreetProps {
  /** reach start / traversal duration for origin A and B (minutes) */
  ta: number;
  da: number;
  tb: number;
  db: number;
  /** width multiplier: 1 minor, 1.6 major/bridge */
  w: number;
  [key: string]: number;
}

export function buildStreetCollection(city: CityModel): FeatureCollection<LineString, StreetProps> {
  const features: Feature<LineString, StreetProps>[] = city.edges.map((e, i) => ({
    type: 'Feature',
    id: i,
    properties: { ta: UNREACHED, da: 1, tb: UNREACHED, db: 1, w: e.kind === EDGE_MINOR ? 1 : 1.6 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [city.nodes[e.a].x, city.nodes[e.a].y],
        [city.nodes[e.b].x, city.nodes[e.b].y],
      ],
    },
  }));
  return { type: 'FeatureCollection', features };
}

export interface TransitSegProps {
  color: string;
  line: string;
  /** minutes when the glow enters / fully covers this sub-segment */
  t0: number;
  t1: number;
  [key: string]: number | string;
}

const SUBDIVISIONS = 6;

/**
 * Each station-to-station hop is split into sub-segments so the glow visibly
 * crawls along the line between stations. Geometry is static; t0/t1 are
 * rewritten whenever reach times change.
 */
export function buildTransitCollection(tube: TubeNetwork): FeatureCollection<LineString, TransitSegProps> {
  const features: Feature<LineString, TransitSegProps>[] = [];
  for (const line of tube.lines) {
    for (let h = 0; h < line.stations.length - 1; h++) {
      const a = tube.stations[tube.stationIndex.get(line.stations[h])!].pos;
      const b = tube.stations[tube.stationIndex.get(line.stations[h + 1])!].pos;
      for (let s = 0; s < SUBDIVISIONS; s++) {
        const f0 = s / SUBDIVISIONS;
        const f1 = (s + 1) / SUBDIVISIONS;
        features.push({
          type: 'Feature',
          properties: { color: line.color, line: line.id, t0: UNREACHED, t1: UNREACHED + 1 },
          geometry: {
            type: 'LineString',
            coordinates: [
              [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0],
              [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1],
            ],
          },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Rewrite transit sub-segment times from per-station reach minutes.
 * Direction of travel along each hop follows whichever end is reached first.
 */
export function updateTransitTimes(
  tube: TubeNetwork,
  fc: FeatureCollection<LineString, TransitSegProps>,
  stationMin: (si: number) => number,
): void {
  let fi = 0;
  for (const line of tube.lines) {
    for (let h = 0; h < line.stations.length - 1; h++) {
      const siA = tube.stationIndex.get(line.stations[h])!;
      const siB = tube.stationIndex.get(line.stations[h + 1])!;
      let tA = stationMin(siA);
      let tB = stationMin(siB);
      // platform-to-platform travel: ride begins once the earlier station is
      // reached, arrives at the later one hopMinutes later
      const forward = tA <= tB;
      const tStart = Math.min(tA, tB);
      const hop = line.hopMinutes;
      for (let s = 0; s < SUBDIVISIONS; s++) {
        const f = features(fc, fi);
        const k = forward ? s : SUBDIVISIONS - 1 - s;
        f.t0 = tStart >= UNREACHED ? UNREACHED : tStart + (k / SUBDIVISIONS) * hop;
        f.t1 = tStart >= UNREACHED ? UNREACHED + 1 : tStart + ((k + 1) / SUBDIVISIONS) * hop;
        fi++;
      }
    }
  }
}

function features(fc: FeatureCollection<LineString, TransitSegProps>, i: number): TransitSegProps {
  return fc.features[i].properties;
}

export interface StationProps {
  name: string;
  t: number;
  interchange: 0 | 1;
  [key: string]: number | string;
}

export function buildStationCollection(tube: TubeNetwork): FeatureCollection<Point, StationProps> {
  return {
    type: 'FeatureCollection',
    features: tube.stations.map((s) => ({
      type: 'Feature',
      properties: { name: s.name, t: UNREACHED, interchange: s.lines.length > 1 ? 1 : 0 },
      geometry: { type: 'Point', coordinates: s.pos },
    })),
  };
}

export function polygonFeature(ring: [number, number][]): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
  };
}
