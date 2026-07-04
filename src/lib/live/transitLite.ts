import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from '../geo';
import { ANY_CHANGES, type JourneyOptions, type LngLat, type TubeNetwork } from '../types';
import { CYCLE_KMH, DETOUR, WALK_KMH } from './timeField';

/**
 * Station reach times: access the network by walk/cycle within the budget,
 * ride the hop graph with interchange penalties, transfer on foot between
 * nearby stations/stops, and (optionally) respect a maximum number of
 * changes via a layered Dijkstra where each boarding climbs one layer.
 */

const STATION_ENTRY_MIN = 2.5; // enter + reach platform
const INTERCHANGE_MIN = 3.5; // charged as half on board, half on alight
const STATION_EXIT_MIN = 1.0;
const TRANSFER_MAX_KM = 0.28; // out-of-station walking transfers
const TRANSFER_PENALTY_MIN = 1.0;
const TRANSFER_MAX_PER_STATION = 6;

class Heap {
  private d: number[] = [];
  private v: number[] = [];
  size = 0;
  push(dist: number, val: number) {
    let i = this.size++;
    this.d[i] = dist;
    this.v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      [this.d[i], this.d[p]] = [this.d[p], this.d[i]];
      [this.v[i], this.v[p]] = [this.v[p], this.v[i]];
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.d[0], this.v[0]];
    this.size--;
    if (this.size > 0) {
      this.d[0] = this.d[this.size];
      this.v[0] = this.v[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.d[l] < this.d[m]) m = l;
        if (r < this.size && this.d[r] < this.d[m]) m = r;
        if (m === i) break;
        [this.d[i], this.d[m]] = [this.d[m], this.d[i]];
        [this.v[i], this.v[m]] = [this.v[m], this.v[i]];
        i = m;
      }
    }
    return top;
  }
}

/** walking transfer edges between nearby stations, cached per network */
const transferCache = new WeakMap<TubeNetwork, Array<Array<[number, number]>>>();

function transferEdges(tube: TubeNetwork): Array<Array<[number, number]>> {
  const hit = transferCache.get(tube);
  if (hit) return hit;
  const S = tube.stations.length;
  const out: Array<Array<[number, number]>> = Array.from({ length: S }, () => []);
  // coarse grid for neighbour lookup
  const CELL = 0.005; // ~0.35-0.55 km
  const grid = new Map<string, number[]>();
  tube.stations.forEach((s, i) => {
    const key = `${Math.round(s.pos[0] / CELL)}:${Math.round(s.pos[1] / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  });
  tube.stations.forEach((s, i) => {
    const cx = Math.round(s.pos[0] / CELL);
    const cy = Math.round(s.pos[1] / CELL);
    const cands: Array<[number, number]> = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (j === i) continue;
          const o = tube.stations[j];
          const km = Math.hypot((s.pos[0] - o.pos[0]) * KM_PER_DEG_LNG, (s.pos[1] - o.pos[1]) * KM_PER_DEG_LAT);
          if (km <= TRANSFER_MAX_KM) {
            cands.push([j, ((km * DETOUR) / WALK_KMH) * 60 + TRANSFER_PENALTY_MIN]);
          }
        }
      }
    }
    cands.sort((a, b) => a[1] - b[1]);
    out[i] = cands.slice(0, TRANSFER_MAX_PER_STATION);
  });
  transferCache.set(tube, out);
  return out;
}

export function computeTransitStationTimes(
  tube: TubeNetwork,
  origin: LngLat,
  options: JourneyOptions,
): Float32Array {
  const S = tube.stations.length;
  const hops = tube.hops.filter((h) => options.methods[tube.lines[h.line].mode]);

  // platform node per (line, station) present in the enabled hop graph
  const platformId = new Map<string, number>();
  for (const h of hops) {
    for (const si of [h.a, h.b]) {
      const key = `${h.line}:${si}`;
      if (!platformId.has(key)) platformId.set(key, platformId.size);
    }
  }
  const P = platformId.size;
  const platformStation = new Int32Array(P);
  for (const [key, pid] of platformId) platformStation[pid] = Number(key.split(':')[1]);

  const platformHops: Array<Array<[number, number]>> = Array.from({ length: P }, () => []);
  for (const h of hops) {
    const pa = platformId.get(`${h.line}:${h.a}`)!;
    const pb = platformId.get(`${h.line}:${h.b}`)!;
    platformHops[pa].push([pb, h.minutes]);
    platformHops[pb].push([pa, h.minutes]);
  }
  const platformsAtStation: Array<number[]> = Array.from({ length: S }, () => []);
  for (let p = 0; p < P; p++) platformsAtStation[platformStation[p]].push(p);

  const transfers = transferEdges(tube);

  const inService = new Uint8Array(S);
  for (const h of hops) {
    inService[h.a] = 1;
    inService[h.b] = 1;
  }

  // access seeds (bike is at the beacon end only when departing)
  const bikeOnAccess = options.access === 'cycle' && options.direction === 'depart';
  const accessKmh = bikeOnAccess ? CYCLE_KMH : WALK_KMH;
  const seeds: Array<[number, number]> = [];
  tube.stations.forEach((s, si) => {
    if (!inService[si]) return;
    const dx = (s.pos[0] - origin[0]) * KM_PER_DEG_LNG;
    const dy = (s.pos[1] - origin[1]) * KM_PER_DEG_LAT;
    const km = Math.sqrt(dx * dx + dy * dy) * DETOUR;
    const access = (km / accessKmh) * 60;
    if (access > options.maxAccessMin) return;
    seeds.push([si, access + STATION_ENTRY_MIN]);
  });

  // boardings allowed: changes + 1 (unlimited -> single layer, fastest path)
  const layers = options.maxChanges >= ANY_CHANGES ? 1 : Math.max(1, Math.min(4, options.maxChanges + 1));
  const layered = layers > 1 || options.maxChanges === 0;

  // node ids: layer * (S + P) + [lobby si | S + platform p]
  const stride = S + P;
  const total = stride * (layered ? layers + 1 : 1);
  const dist = new Float64Array(total).fill(Infinity);
  const heap = new Heap();

  const lobbyAt = (si: number, layer: number) => layer * stride + si;
  const platAt = (p: number, layer: number) => layer * stride + S + p;
  const maxLayer = layered ? layers : 0;

  for (const [si, d] of seeds) {
    const id = lobbyAt(si, 0);
    if (d < dist[id]) {
      dist[id] = d;
      heap.push(d, id);
    }
  }

  const relax = (id: number, nd: number) => {
    if (nd < dist[id]) {
      dist[id] = nd;
      heap.push(nd, id);
    }
  };

  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    const layer = layered ? Math.floor(u / stride) : 0;
    const local = u % stride;
    if (local < S) {
      // lobby: walk transfers stay in layer; boarding climbs a layer
      const si = local;
      for (const [sj, w] of transfers[si]) {
        if (inService[sj]) relax(lobbyAt(sj, layer), d + w);
      }
      const boardLayer = layered ? layer + 1 : 0;
      if (!layered || boardLayer <= maxLayer) {
        for (const p of platformsAtStation[si]) relax(platAt(p, boardLayer), d + INTERCHANGE_MIN / 2);
      }
    } else {
      // platform: ride within layer; alight to the lobby of the same layer
      const p = local - S;
      for (const [q, w] of platformHops[p]) relax(platAt(q, layer), d + w);
      relax(lobbyAt(platformStation[p], layer), d + INTERCHANGE_MIN / 2);
    }
  }

  const out = new Float32Array(S);
  for (let si = 0; si < S; si++) {
    let best = Infinity;
    for (let layer = 0; layer <= maxLayer; layer++) best = Math.min(best, dist[lobbyAt(si, layer)]);
    out[si] = best + STATION_EXIT_MIN;
  }
  return out;
}
