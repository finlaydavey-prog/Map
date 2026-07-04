import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from '../geo';
import type { JourneyOptions, LngLat, TubeNetwork } from '../types';
import { CYCLE_KMH, DETOUR, WALK_KMH } from './timeField';

/**
 * Station reach times without a street graph: walk (or cycle, within the
 * budget) straight to any station, then ride the hop graph with interchange
 * penalties. Only lines whose method toggle is on participate. Hop times
 * come from the TfL snapshot (distance-derived); swapping in real Journey
 * Planner timings later only changes those numbers.
 */

const STATION_ENTRY_MIN = 2.5; // enter + reach platform
const INTERCHANGE_MIN = 3.5;
const STATION_EXIT_MIN = 1.0;

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

export function computeTransitStationTimes(
  tube: TubeNetwork,
  origin: LngLat,
  options: JourneyOptions,
): Float32Array {
  const S = tube.stations.length;
  const hops = tube.hops.filter((h) => options.methods[tube.lines[h.line].mode]);

  // lobby node per station (0..S-1), platform node per (line, station)
  const platformId = new Map<string, number>();
  for (const h of hops) {
    for (const si of [h.a, h.b]) {
      const key = `${h.line}:${si}`;
      if (!platformId.has(key)) platformId.set(key, S + platformId.size);
    }
  }
  const total = S + platformId.size;
  const adj: Array<Array<[number, number]>> = Array.from({ length: total }, () => []);

  for (const [key, pid] of platformId) {
    const si = Number(key.split(':')[1]);
    // lobby <-> platform: half the interchange penalty each way
    adj[si].push([pid, INTERCHANGE_MIN / 2]);
    adj[pid].push([si, INTERCHANGE_MIN / 2]);
  }
  for (const h of hops) {
    const pa = platformId.get(`${h.line}:${h.a}`)!;
    const pb = platformId.get(`${h.line}:${h.b}`)!;
    adj[pa].push([pb, h.minutes]);
    adj[pb].push([pa, h.minutes]);
  }

  // stations with no enabled service can't be entered
  const inService = new Uint8Array(S);
  for (const h of hops) {
    inService[h.a] = 1;
    inService[h.b] = 1;
  }

  const dist = new Float64Array(total).fill(Infinity);
  const heap = new Heap();
  const accessKmh = options.access === 'cycle' ? CYCLE_KMH : WALK_KMH;
  tube.stations.forEach((s, si) => {
    if (!inService[si]) return;
    const dx = (s.pos[0] - origin[0]) * KM_PER_DEG_LNG;
    const dy = (s.pos[1] - origin[1]) * KM_PER_DEG_LAT;
    const km = Math.sqrt(dx * dx + dy * dy) * DETOUR;
    const access = (km / accessKmh) * 60;
    if (access > options.maxAccessMin) return;
    const d = access + STATION_ENTRY_MIN;
    if (d < dist[si]) {
      dist[si] = d;
      heap.push(d, si);
    }
  });
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    for (const [v, w] of adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        heap.push(nd, v);
      }
    }
  }

  const out = new Float32Array(S);
  for (let si = 0; si < S; si++) out[si] = dist[si] + STATION_EXIT_MIN;
  return out;
}
