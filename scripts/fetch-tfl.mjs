#!/usr/bin/env node
/**
 * Regenerates src/data/tfl-network.json from the TfL Unified API.
 *
 *   TFL_APP_KEY=xxxx node scripts/fetch-tfl.mjs
 *
 * The snapshot (public network data: lines, stations, hop times) is committed
 * so the app needs no TfL key or API calls at runtime. Re-run when TfL
 * changes the network. Hop times are estimated from inter-station distance
 * per mode; swap for Journey Planner timings later if exactness matters.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.TFL_APP_KEY;
if (!KEY) {
  console.error('Set TFL_APP_KEY (free at api-portal.tfl.gov.uk)');
  process.exit(1);
}

// keep the network within (padded) app camera bounds
const BBOX = { lngMin: -0.6, latMin: 51.2, lngMax: 0.4, latMax: 51.78 };

// official TfL line colours
const COLOURS = {
  bakerloo: '#B36305', central: '#E32017', circle: '#FFD300', district: '#00782A',
  'hammersmith-city': '#F3A9BB', jubilee: '#A0A5A9', metropolitan: '#9B0056',
  northern: '#000000', piccadilly: '#003688', victoria: '#0098D4',
  'waterloo-city': '#95CDBA', elizabeth: '#6950A1', dlr: '#00A4A7',
  lioness: '#FAA61A', mildmay: '#0077AD', windrush: '#ED1B00',
  weaver: '#823A85', suffragette: '#5BBD72', liberty: '#5D6062',
};
const FALLBACK_COLOUR = '#EE7C0E';

// effective speeds (km/h) + dwell for distance-based hop times
const SPEEDS = { tube: 30, 'elizabeth-line': 48, dlr: 28, overground: 38 };
const DWELL_MIN = 0.6;

const KM_LAT = 110.9;
const KM_LNG = 69.3;
const distKm = (a, b) =>
  Math.sqrt(((a.lon - b.lon) * KM_LNG) ** 2 + ((a.lat - b.lat) * KM_LAT) ** 2);

const get = async (path) => {
  const res = await fetch(`https://api.tfl.gov.uk${path}${path.includes('?') ? '&' : '?'}app_key=${KEY}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};

const lines = await get('/Line/Mode/tube,elizabeth-line,dlr,overground');
console.log(`${lines.length} lines`);

const stationById = new Map(); // stationId -> {id, name, lat, lon}
const outLines = [];
const hopSet = new Set();
const hops = [];

for (const line of lines) {
  const lineIdx = outLines.length;
  outLines.push({
    id: line.id,
    name: line.name,
    color: COLOURS[line.id] ?? FALLBACK_COLOUR,
    mode: line.modeName,
  });
  const seq = await get(`/Line/${line.id}/Route/Sequence/all`);
  // NB: seq.stations is incomplete; stopPointSequences covers every stop
  for (const sps of seq.stopPointSequences ?? []) {
    for (const s of sps.stopPoint ?? []) {
      if (!stationById.has(s.id)) {
        stationById.set(s.id, {
          id: s.id,
          name: s.name.replace(/ (Underground|Rail|DLR) Station$/, ''),
          lat: +s.lat.toFixed(5),
          lon: +s.lon.toFixed(5),
        });
      }
    }
  }
  const speed = SPEEDS[line.modeName] ?? 32;
  for (const route of seq.orderedLineRoutes ?? []) {
    const ids = route.naptanIds ?? [];
    for (let i = 1; i < ids.length; i++) {
      const a = stationById.get(ids[i - 1]);
      const b = stationById.get(ids[i]);
      if (!a || !b) continue;
      const inBox = (p) => p.lon > BBOX.lngMin && p.lon < BBOX.lngMax && p.lat > BBOX.latMin && p.lat < BBOX.latMax;
      if (!inBox(a) || !inBox(b)) continue;
      const key = `${line.id}:${[a.id, b.id].sort().join('-')}`;
      if (hopSet.has(key)) continue;
      hopSet.add(key);
      const minutes = +Math.max(1.0, (distKm(a, b) / speed) * 60 + DWELL_MIN).toFixed(2);
      hops.push({ line: lineIdx, a: a.id, b: b.id, minutes });
    }
  }
  console.log(`  ${line.id}: ${seq.stations?.length ?? 0} stations, hops so far ${hops.length}`);
}

// keep only stations referenced by kept hops
const used = new Set(hops.flatMap((h) => [h.a, h.b]));
const stations = [...stationById.values()].filter((s) => used.has(s.id));
const stationIdx = new Map(stations.map((s, i) => [s.id, i]));
const outHops = hops.map((h) => ({ line: h.line, a: stationIdx.get(h.a), b: stationIdx.get(h.b), minutes: h.minutes }));

const out = {
  generated: new Date().toISOString(),
  source: 'TfL Unified API (Line/Route/Sequence)',
  lines: outLines,
  stations,
  hops: outHops,
};

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'tfl-network.json'), JSON.stringify(out));
console.log(`wrote src/data/tfl-network.json: ${outLines.length} lines, ${stations.length} stations, ${outHops.length} hops`);
