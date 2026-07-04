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
  /** line ids serving this station (length > 1 -> interchange) */
  lines: string[];
}

/** toggleable transit networks (bus / national rail to come) */
export type TransitMethod = 'tube' | 'elizabeth-line' | 'dlr' | 'overground';

/** how the user reaches (and leaves) the transit network */
export type AccessMode = 'walk' | 'cycle';

export interface JourneyOptions {
  methods: Record<TransitMethod, boolean>;
  access: AccessMode;
  /** longest single access leg the user will accept, minutes */
  maxAccessMin: number;
}

export const DEFAULT_JOURNEY: JourneyOptions = {
  methods: { tube: true, 'elizabeth-line': true, dlr: true, overground: true },
  access: 'walk',
  maxAccessMin: 15,
};

export interface TubeLine {
  id: string;
  name: string;
  color: string;
  /** which toggleable method this line belongs to */
  mode: TransitMethod;
}

/** one ride between adjacent stations on one line (branches are just hops) */
export interface TubeHop {
  /** index into TubeNetwork.lines */
  line: number;
  /** station indices */
  a: number;
  b: number;
  minutes: number;
  /** curved geometry through the route's neighbouring stations */
  geom?: LngLat[];
}

export interface TubeNetwork {
  lines: TubeLine[];
  stations: TubeStation[];
  hops: TubeHop[];
  stationIndex: Map<string, number>;
}
