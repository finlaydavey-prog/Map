import { profilesFromReach, ringFromProfile } from '../bands';
import { computeReach } from '../reach';
import type { CityModel, IsochroneBand, IsochroneProvider, LngLat, TravelMode, TubeNetwork } from '../types';

/** Coarse bands fetched per origin; every 1-minute step in between is interpolated client-side. */
export const BAND_MINUTES = [10, 20, 30, 40, 50, 60];

function cacheKey(origin: LngLat, mode: TravelMode, minutes: number[]): string {
  return `${mode}:${origin[0].toFixed(4)},${origin[1].toFixed(4)}:${minutes.join('-')}`;
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
