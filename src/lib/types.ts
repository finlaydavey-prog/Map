export type LngLat = [number, number];

export type TravelMode = 'drive' | 'transit' | 'walk' | 'cycle';

export const MODES: TravelMode[] = ['drive', 'transit', 'walk', 'cycle'];

/** One reachability contour returned by an isochrone provider. */
export interface IsochroneBand {
  /** Travel-time budget for this contour, in minutes. */
  minutes: number;
  /** Closed polygon ring (first point NOT repeated). */
  ring: LngLat[];
}

/**
 * Everything isochrone-shaped goes through this interface so the mock
 * provider, Mapbox Isochrone (drive/walk/cycle) and Geoapify or a
 * TfL-derived transit provider can be swapped without touching rendering.
 */
export interface IsochroneProvider {
  readonly id: string;
  /** Which modes this provider can answer for. */
  supports(mode: TravelMode): boolean;
  /**
   * Fetch ALL requested contours for one origin in as few requests as the
   * backend allows (Mapbox: 4 contours/request, so 8 bands = 2 requests).
   * Implementations must cache by (origin, mode, minutes) — the app never
   * refetches while the slider moves.
   */
  fetchBands(origin: LngLat, mode: TravelMode, minutes: number[]): Promise<IsochroneBand[]>;
}

export interface StreetNode {
  x: number; // lng
  y: number; // lat
}

export const EDGE_MINOR = 0;
export const EDGE_MAJOR = 1;
export const EDGE_BRIDGE = 2;

export interface StreetEdge {
  a: number;
  b: number;
  kind: number; // EDGE_*
  lenKm: number;
}

export interface CityModel {
  nodes: StreetNode[];
  edges: StreetEdge[];
  /** adjacency: for each node, list of [edgeIndex, otherNode] pairs flattened */
  adj: Array<Array<[number, number]>>;
  riverRing: LngLat[];
  parkRings: LngLat[][];
  bbox: [number, number, number, number]; // lngMin, latMin, lngMax, latMax
  /** approximate km² of city area represented by one street node */
  cellAreaKm2: number;
}

export interface TubeStation {
  id: string;
  name: string;
  pos: LngLat;
  lines: string[];
}

export interface TubeLine {
  id: string;
  name: string;
  color: string;
  /** ordered station ids */
  stations: string[];
  /** minutes between adjacent stations */
  hopMinutes: number;
}

export interface TubeNetwork {
  lines: TubeLine[];
  stations: TubeStation[];
  stationIndex: Map<string, number>;
}
