#!/usr/bin/env node
/**
 * Regenerates src/data/tfl-network.json from the TfL Unified API.
 *
 *   TFL_APP_KEY=xxxx node scripts/fetch-tfl.mjs
 *
 * Fetches: tube + Elizabeth line + DLR + Overground + National Rail
 * (curved geometry, per-hop minutes from the Timetable API where available,
 * distance-based fallback) and the full bus network (676 routes merged into
 * one corridor graph: stops within ~200 m collapsed, hops deduped,
 * distance-based times). The snapshot is committed; no key at runtime.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.TFL_APP_KEY;
if (!KEY) {
  console.error('Set TFL_APP_KEY (free at api-portal.tfl.gov.uk)');
  process.exit(1);
}

const BBOX = { lngMin: -0.6, latMin: 51.2, lngMax: 0.4, latMax: 51.78 };
const inBox = (p) => p.lon > BBOX.lngMin && p.lon < BBOX.lngMax && p.lat > BBOX.latMin && p.lat < BBOX.latMax;

const COLOURS = {
  bakerloo: '#B36305', central: '#E32017', circle: '#FFD300', district: '#00782A',
  'hammersmith-city': '#F3A9BB', jubilee: '#A0A5A9', metropolitan: '#9B0056',
  northern: '#000000', piccadilly: '#003688', victoria: '#0098D4',
  'waterloo-city': '#95CDBA', elizabeth: '#6950A1', dlr: '#00A4A7',
  lioness: '#FAA61A', mildmay: '#0077AD', windrush: '#ED1B00',
  weaver: '#823A85', suffragette: '#5BBD72', liberty: '#5D6062',
};
const RAIL_COLOUR = '#3E5A75';
const BUS_COLOUR = '#DC241F';

const SPEEDS = { tube: 30, 'elizabeth-line': 48, dlr: 28, overground: 38, 'national-rail': 55 };
const DWELL_MIN = 0.6;
const BUS_KMH = 13.5;
const BUS_DWELL = 0.5;

const KM_LAT = 110.9;
const KM_LNG = 69.3;
const distKm = (a, b) => Math.sqrt(((a.lon - b.lon) * KM_LNG) ** 2 + ((a.lat - b.lat) * KM_LAT) ** 2);

const curvedHop = (p0, p1, p2, p3, samples = 8) => {
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const t2 = t * t;
    const t3 = t2 * t;
    out.push([
      +(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)).toFixed(5),
      +(0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)).toFixed(5),
    ]);
  }
  return out;
};

async function get(path, attempt = 0) {
  const res = await fetch(`https://api.tfl.gov.uk${path}${path.includes('?') ? '&' : '?'}app_key=${KEY}`);
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function pool(items, worker, concurrency = 6) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await worker(items[idx]);
        } catch (e) {
          console.error(`  ! ${items[idx].id ?? items[idx]}: ${e.message}`);
          out[idx] = null;
        }
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- rail modes

const stationById = new Map(); // id -> {id, name, lat, lon, k}
const outLines = [];
const hopSet = new Set();
const hops = []; // {line, a: id, b: id, minutes, geom?}

async function fetchRailLike(lineList, mode) {
  for (const line of lineList) {
    const lineIdx = outLines.length;
    outLines.push({
      id: line.id,
      name: line.name,
      color: mode === 'national-rail' ? RAIL_COLOUR : (COLOURS[line.id] ?? '#EE7C0E'),
      mode,
    });
    let seq;
    try {
      seq = await get(`/Line/${line.id}/Route/Sequence/all`);
    } catch (e) {
      console.error(`  ! ${line.id}: ${e.message}`);
      continue;
    }
    for (const sps of seq.stopPointSequences ?? []) {
      for (const s of sps.stopPoint ?? []) {
        if (!stationById.has(s.id)) {
          stationById.set(s.id, {
            id: s.id,
            name: s.name.replace(/ (Underground|Rail|DLR) Station$/, ''),
            lat: +s.lat.toFixed(5),
            lon: +s.lon.toFixed(5),
            k: 's',
          });
        }
      }
    }

    // real per-hop minutes from the timetable, where the API provides them
    const ttMinutes = new Map(); // "a-b" -> [minutes...]
    const routes = seq.orderedLineRoutes ?? [];
    for (const route of routes.slice(0, 6)) {
      const from = route.naptanIds?.[0];
      if (!from) continue;
      try {
        const tt = await get(`/Line/${line.id}/Timetable/${from}`);
        for (const r of tt.timetable?.routes ?? []) {
          for (const si of r.stationIntervals ?? []) {
            let prevId = from;
            let prevT = 0;
            for (const iv of si.intervals ?? []) {
              const dt = iv.timeToArrival - prevT;
              if (dt > 0 && dt < 60) {
                const key = [prevId, iv.stopId].sort().join('-');
                if (!ttMinutes.has(key)) ttMinutes.set(key, []);
                ttMinutes.get(key).push(dt);
              }
              prevId = iv.stopId;
              prevT = iv.timeToArrival;
            }
          }
        }
      } catch {
        /* timetable unavailable -> distance fallback */
      }
    }
    const median = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];

    const speed = SPEEDS[mode] ?? 32;
    let ttHits = 0;
    for (const route of routes) {
      const ids = route.naptanIds ?? [];
      for (let i = 1; i < ids.length; i++) {
        const a = stationById.get(ids[i - 1]);
        const b = stationById.get(ids[i]);
        if (!a || !b || !inBox(a) || !inBox(b)) continue;
        const key = `${line.id}:${[a.id, b.id].sort().join('-')}`;
        if (hopSet.has(key)) continue;
        hopSet.add(key);
        const tt = ttMinutes.get([a.id, b.id].sort().join('-'));
        if (tt) ttHits++;
        const minutes = tt
          ? +(median(tt) + 0.0).toFixed(2)
          : +Math.max(1.0, (distKm(a, b) / speed) * 60 + DWELL_MIN).toFixed(2);
        const prev = stationById.get(ids[i - 2]) ?? a;
        const next = stationById.get(ids[i + 1]) ?? b;
        const P = (s) => [s.lon, s.lat];
        hops.push({ line: lineIdx, a: a.id, b: b.id, minutes, geom: curvedHop(P(prev), P(a), P(b), P(next)) });
      }
    }
    console.log(`  ${line.id}: hops ${hops.length} (timetable-timed this line: ${ttHits})`);
  }
}

console.log('== rapid transit ==');
const rapid = await get('/Line/Mode/tube,elizabeth-line,dlr,overground');
for (const l of rapid) await fetchRailLike([l], l.modeName);

console.log('== national rail ==');
const rail = await get('/Line/Mode/national-rail');
for (const l of rail) await fetchRailLike([l], 'national-rail');

// ---------------------------------------------------------------------- bus

console.log('== bus ==');
const busLineIdx = outLines.length;
outLines.push({ id: 'bus', name: 'Bus', color: BUS_COLOUR, mode: 'bus' });

const busStops = new Map(); // id -> {id,name,lat,lon}
const busPairs = new Map(); // "a-b" -> true (raw stop ids)
const busLines = await get('/Line/Mode/bus');
console.log(`${busLines.length} bus routes`);
let done = 0;
await pool(busLines, async (line) => {
  const seq = await get(`/Line/${line.id}/Route/Sequence/all`);
  for (const sps of seq.stopPointSequences ?? []) {
    for (const s of sps.stopPoint ?? []) {
      if (!busStops.has(s.id)) {
        busStops.set(s.id, { id: s.id, name: s.name, lat: +s.lat.toFixed(4), lon: +s.lon.toFixed(4) });
      }
    }
  }
  for (const route of seq.orderedLineRoutes ?? []) {
    const ids = route.naptanIds ?? [];
    for (let i = 1; i < ids.length; i++) busPairs.set([ids[i - 1], ids[i]].sort().join('|'), true);
  }
  if (++done % 100 === 0) console.log(`  ...${done}/${busLines.length} routes`);
});

// merge stops within ~200 m so opposite-side pairs collapse
const CELL_LAT = 0.0018;
const CELL_LNG = 0.0028;
const repByCell = new Map();
const repOf = new Map(); // raw id -> rep id
for (const s of busStops.values()) {
  if (!inBox(s)) continue;
  const cell = `${Math.round(s.lat / CELL_LAT)}:${Math.round(s.lon / CELL_LNG)}`;
  if (!repByCell.has(cell)) repByCell.set(cell, s);
  repOf.set(s.id, repByCell.get(cell).id);
}
const busHopSet = new Map(); // "a-b" (rep ids) -> minutes
for (const key of busPairs.keys()) {
  const [ra, rb] = key.split('|').map((id) => repOf.get(id));
  if (!ra || !rb || ra === rb) continue;
  const a = busStops.get(ra);
  const b = busStops.get(rb);
  const hkey = [ra, rb].sort().join('-');
  if (busHopSet.has(hkey)) continue;
  const minutes = +Math.max(0.8, (distKm(a, b) / BUS_KMH) * 60 + BUS_DWELL).toFixed(2);
  busHopSet.set(hkey, minutes);
}
const usedBusReps = new Set();
for (const key of busHopSet.keys()) {
  const [a, b] = key.split('-');
  usedBusReps.add(a);
  usedBusReps.add(b);
}
for (const rep of usedBusReps) {
  const s = busStops.get(rep);
  stationById.set(rep, {
    id: rep,
    name: s.name.replace(/ Bus Station$/, ''),
    lat: s.lat,
    lon: s.lon,
    k: 'b',
  });
}
for (const [key, minutes] of busHopSet) {
  const [a, b] = key.split('-');
  hops.push({ line: busLineIdx, a, b, minutes });
}
console.log(`bus: ${usedBusReps.size} merged stops, ${busHopSet.size} corridor hops`);

// --------------------------------------------------------------------- emit

const used = new Set(hops.flatMap((h) => [h.a, h.b]));
const stations = [...stationById.values()].filter((s) => used.has(s.id));
const stationIdx = new Map(stations.map((s, i) => [s.id, i]));
const outHops = hops.map((h) => ({
  line: h.line,
  a: stationIdx.get(h.a),
  b: stationIdx.get(h.b),
  minutes: h.minutes,
  ...(h.geom ? { geom: h.geom } : {}),
}));

const out = {
  generated: new Date().toISOString(),
  source: 'TfL Unified API (Route/Sequence + Timetable)',
  lines: outLines,
  stations,
  hops: outHops,
};

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'tfl-network.json'), JSON.stringify(out));
console.log(`wrote tfl-network.json: ${outLines.length} lines, ${stations.length} stations, ${outHops.length} hops`);
