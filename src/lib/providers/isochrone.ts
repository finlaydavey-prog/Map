import { profilesFromReach, ringFromProfile } from '../bands';
import { computeReach } from '../reach';
import type { CityModel, IsochroneBand, IsochroneProvider, LngLat, TravelMode, TubeNetwork } from '../types';

/** Coarse bands fetched per origin; every 1-minute step in between is interpolated client-side. */
export const BAND_MINUTES = [10, 20, 30, 40, 50, 60];

function cacheKey(origin: LngLat, mode: TravelMode, minutes: number[]): string {
  return `${mode}:${origin[0].toFixed(4)},${origin[1].toFixed(4)}:${minutes.join('-')}`;
}

const MAPBOX_PROFILES: Partial<Record<TravelMode, string>> = {
  drive: 'driving',
  walk: 'walking',
  cycle: 'cycling',
};

/**
 * Real isochrones from the Mapbox Isochrone API (drive / walk / cycle).
 * The API caps each request at 4 contours, so the 6 coarse bands are fetched
 * as two parallel batched requests, then cached — the slider never refetches.
 * Transit is not supported by Mapbox; see TfL/Geoapify notes below.
 */
export class MapboxIsochroneProvider implements IsochroneProvider {
  readonly id = 'mapbox';
  private cache = new Map<string, IsochroneBand[]>();

  constructor(private token: string) {}

  supports(mode: TravelMode): boolean {
    return mode in MAPBOX_PROFILES;
  }

  async fetchBands(origin: LngLat, mode: TravelMode, minutes: number[]): Promise<IsochroneBand[]> {
    const key = cacheKey(origin, mode, minutes);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const profile = MAPBOX_PROFILES[mode];
    if (!profile) throw new Error(`Mapbox Isochrone does not support mode "${mode}"`);

    const chunks: number[][] = [];
    for (let i = 0; i < minutes.length; i += 4) chunks.push(minutes.slice(i, i + 4));

    const byContour = new Map<number, LngLat[]>();
    await Promise.all(
      chunks.map(async (chunk) => {
        const url =
          `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/` +
          `${origin[0].toFixed(6)},${origin[1].toFixed(6)}` +
          `?contours_minutes=${chunk.join(',')}&polygons=true&denoise=1&access_token=${this.token}`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Isochrone request failed (${res.status}): ${body.slice(0, 140)}`);
        }
        const json = (await res.json()) as {
          features: Array<{ properties: { contour: number }; geometry: { type: string; coordinates: number[][][] } }>;
        };
        for (const f of json.features) {
          // polygons=true -> Polygon geometry; outer ring only
          if (f.geometry.type === 'Polygon' && f.geometry.coordinates[0]?.length > 3) {
            byContour.set(f.properties.contour, f.geometry.coordinates[0] as LngLat[]);
          }
        }
      }),
    );

    const bands: IsochroneBand[] = minutes
      .filter((m) => byContour.has(m))
      .map((m) => ({ minutes: m, ring: byContour.get(m)! }));
    if (bands.length === 0) throw new Error('Isochrone response contained no usable contours');
    this.cache.set(key, bands);
    return bands;
  }
}

/**
 * Mock provider: contours are derived from the bundled street/tube graph and
 * returned after a simulated network delay, so the loading choreography
 * (beacon pulsing alone, then the first ring blooming) is real.
 *
 * Swapping in real backends later, without touching the rendering layer:
 *
 * - MapboxIsochroneProvider (drive / walk / cycle):
 *   GET https://api.mapbox.com/isochrone/v1/mapbox/{profile}/{lng},{lat}
 *     ?contours_minutes=10,20,30,40&polygons=true&access_token=$VITE_MAPBOX_TOKEN
 *   Max 4 contours per request -> issue ceil(bands/4) requests in parallel.
 *
 * - Transit (Mapbox has no transit profile), either:
 *   a) GeoapifyIsochroneProvider: /v1/isoline?type=time&mode=approximated_transit
 *      &range=...&apiKey=$VITE_GEOAPIFY_KEY, or
 *   b) TflTransitProvider: TfL Unified API journey times between stations
 *      (app_key=$VITE_TFL_APP_KEY) + walking isochrones around reached
 *      stations — which is exactly the graph this mock already computes.
 *
 * All implementations must cache by (origin, mode, bands): the slider never
 * triggers a fetch.
 */
export class MockIsochroneProvider implements IsochroneProvider {
  readonly id = 'mock-london';
  private cache = new Map<string, IsochroneBand[]>();

  constructor(
    private city: CityModel,
    private tube: TubeNetwork,
    private latencyMs = () => 420 + Math.random() * 280,
  ) {}

  supports(): boolean {
    return true;
  }

  async fetchBands(origin: LngLat, mode: TravelMode, minutes: number[]): Promise<IsochroneBand[]> {
    const key = cacheKey(origin, mode, minutes);
    const hit = this.cache.get(key);
    if (hit) return hit;

    await new Promise((r) => setTimeout(r, this.latencyMs()));

    const reach = computeReach(this.city, this.tube, origin, mode);
    const profiles = profilesFromReach(this.city, origin, reach.nodeMin, minutes);
    const bands: IsochroneBand[] = minutes.map((m, i) => ({
      minutes: m,
      ring: ringFromProfile(origin, profiles[i]),
    }));
    this.cache.set(key, bands);
    return bands;
  }
}
