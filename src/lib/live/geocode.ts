import type { Place } from '../mock/places';

/** Mapbox Geocoding, proximity-biased to central London and bboxed to Greater London. */
export async function mapboxGeocode(token: string, q: string, limit = 5): Promise<Place[]> {
  const s = q.trim();
  if (s.length < 2) return [];
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(s)}.json` +
    `?proximity=-0.12,51.507&bbox=-0.55,51.25,0.35,51.72&limit=${limit}` +
    `&types=neighborhood,locality,place,poi,address&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const json = (await res.json()) as {
    features: Array<{ text: string; place_name: string; center: [number, number] }>;
  };
  return json.features.map((f) => ({
    name: f.text,
    hint: f.place_name.split(',').slice(1, 3).join(',').trim(),
    pos: f.center,
  }));
}
