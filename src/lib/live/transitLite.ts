import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from '../geo';
import type { LngLat, TubeNetwork } from '../types';

/**
 * Station reach times without a street graph: walk straight to any station
 * (detour-corrected), then ride the hop graph with interchange penalties.
 * Hop times come from the TfL snapshot (distance-derived); swapping in real
 * Journey Planner timings later only changes those numbers.
 */

const WALK_KMH = 4.8;
const DETOUR = 1.35;
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

export function computeTransitStationTimes(tube: TubeNetwork, origin: LngLat): Float32Array {
  const S = tube.stations.length;

  // lobby node per station (0..S-1), platform node per (line, station)
  const platformId = new Map<string, number>();
  for (const h of tube.hops) {
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
  for (const h of tube.hops) {
    const pa = platformId.get(`${h.line}:${h.a}`)!;
    const pb = platformId.get(`${h.line}:${h.b}`)!;
    adj[pa].push([pb, h.minutes]);
    adj[pb].push([pa, h.minutes]);
  }

  const dist = new Float64Array(total).fill(Infinity);
  const heap = new Heap();
  tube.stations.forEach((s, si) => {
    const dx = (s.pos[0] - origin[0]) * KM_PER_DEG_LNG;
    const dy = (s.pos[1] - origin[1]) * KM_PER_DEG_LAT;
    const walk = ((Math.sqrt(dx * dx + dy * dy) * DETOUR) / WALK_KMH) * 60;
    const d = walk + STATION_ENTRY_MIN;
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
