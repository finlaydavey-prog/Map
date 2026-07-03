/** Present -> live mode (real Mapbox basemap, isochrones, geocoding). Absent -> keyless mock mode. */
export const MAPBOX_TOKEN: string | undefined = import.meta.env.VITE_MAPBOX_TOKEN || undefined;

export const LIVE = !!MAPBOX_TOKEN;

/** Greater London camera limits for live mode */
export const LIVE_BOUNDS: [number, number, number, number] = [-0.51, 51.28, 0.33, 51.7];

/** transit reach + area sampling window (central London, matches the tube overlay) */
export const TRANSIT_BBOX: [number, number, number, number] = [-0.35, 51.4, 0.15, 51.62];
