import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { UNREACHED } from '../lib/reach';
import { slicePolyline } from '../lib/tube/curve';
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
  mode: string;
  /** hop index into TubeNetwork.hops + sub-segment position within it */
  hop: number;
  k: number;
  n: number;
  /** minutes when the glow enters / fully covers this sub-segment */
  t0: number;
  t1: number;
  [key: string]: number | string;
}

/**
 * Each station-to-station hop is split into sub-segments so the glow visibly
 * crawls along the line between stations. Geometry is static; t0/t1 are
 * rewritten whenever reach times change.
 */
export function buildTransitCollection(tube: TubeNetwork): FeatureCollection<LineString, TransitSegProps> {
  const features: Feature<LineString, TransitSegProps>[] = [];
  tube.hops.forEach((hop, hi) => {
    const geom = hop.geom ?? [tube.stations[hop.a].pos, tube.stations[hop.b].pos];
    const n = Math.min(8, Math.max(3, Math.round(hop.minutes * 2)));
    for (let k = 0; k < n; k++) {
      features.push({
        type: 'Feature',
        properties: {
          color: tube.lines[hop.line].color,
          mode: tube.lines[hop.line].mode,
          hop: hi,
          k,
          n,
          t0: UNREACHED,
          t1: UNREACHED + 1,
        },
        geometry: { type: 'LineString', coordinates: slicePolyline(geom, k / n, (k + 1) / n) },
      });
    }
  });
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
  for (const feature of fc.features) {
    const p = feature.properties;
    const hop = tube.hops[p.hop as number];
    const tA = stationMin(hop.a);
    const tB = stationMin(hop.b);
    const tStart = Math.min(tA, tB);
    if (tStart >= UNREACHED) {
      p.t0 = UNREACHED;
      p.t1 = UNREACHED + 1;
      continue;
    }
    const k = tA <= tB ? (p.k as number) : (p.n as number) - 1 - (p.k as number);
    p.t0 = tStart + (k / (p.n as number)) * hop.minutes;
    p.t1 = tStart + ((k + 1) / (p.n as number)) * hop.minutes;
  }
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
