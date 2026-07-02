import type { LngLat } from '../types';

export interface Place {
  name: string;
  hint: string;
  pos: LngLat;
}

/**
 * Mock geocoder index. The real build swaps this for Mapbox Geocoding
 * (forward search, proximity-biased to the map centre).
 */
export const PLACES: Place[] = [
  { name: 'Soho', hint: 'W1 · nightlife', pos: [-0.1337, 51.5136] },
  { name: 'Covent Garden', hint: 'WC2', pos: [-0.1226, 51.5117] },
  { name: 'Shoreditch', hint: 'E1 · Tech City', pos: [-0.0786, 51.5245] },
  { name: 'Camden Town', hint: 'NW1', pos: [-0.1426, 51.5392] },
  { name: 'Westminster', hint: 'SW1 · Parliament', pos: [-0.1254, 51.501] },
  { name: 'Waterloo', hint: 'SE1 · South Bank', pos: [-0.1134, 51.5036] },
  { name: "King's Cross", hint: 'N1C', pos: [-0.1238, 51.5308] },
  { name: 'Notting Hill', hint: 'W11', pos: [-0.1963, 51.5094] },
  { name: 'Brixton', hint: 'SW2', pos: [-0.1145, 51.4627] },
  { name: 'Victoria', hint: 'SW1', pos: [-0.1441, 51.4965] },
  { name: 'Bank', hint: 'EC3 · The City', pos: [-0.0886, 51.5133] },
  { name: 'London Bridge', hint: 'SE1 · Borough', pos: [-0.0864, 51.5052] },
  { name: 'Paddington', hint: 'W2', pos: [-0.1774, 51.5154] },
  { name: 'Mayfair', hint: 'W1K', pos: [-0.1478, 51.5095] },
  { name: 'Marylebone', hint: 'W1U', pos: [-0.1527, 51.5186] },
  { name: 'Clapham', hint: 'SW4', pos: [-0.138, 51.4622] },
  { name: 'Bermondsey', hint: 'SE16', pos: [-0.0637, 51.4979] },
  { name: 'Whitechapel', hint: 'E1', pos: [-0.0612, 51.5194] },
  { name: 'Canary Wharf', hint: 'E14', pos: [-0.0209, 51.5036] },
  { name: 'Angel', hint: 'N1 · Islington', pos: [-0.1058, 51.5326] },
  { name: 'Elephant & Castle', hint: 'SE1', pos: [-0.0999, 51.4943] },
  { name: 'Battersea', hint: 'SW11', pos: [-0.1554, 51.4718] },
  { name: 'Pimlico', hint: 'SW1V', pos: [-0.1334, 51.4893] },
  { name: 'Holborn', hint: 'WC1', pos: [-0.12, 51.5174] },
];

export function searchPlaces(q: string, limit = 5): Place[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const scored = PLACES.map((p) => {
    const n = p.name.toLowerCase();
    let score = -1;
    if (n === s) score = 100;
    else if (n.startsWith(s)) score = 60 + s.length;
    else if (n.includes(s)) score = 30 + s.length;
    else if (p.hint.toLowerCase().includes(s)) score = 10;
    return { p, score };
  })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.p);
}
