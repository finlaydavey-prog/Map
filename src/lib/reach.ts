import { nearestNode } from './mock/city';
import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from './geo';
import type { CityModel, LngLat, TravelMode, TubeNetwork } from './types';
import { EDGE_BRIDGE, EDGE_MAJOR } from './types';

export const UNREACHED = 9999;

/** Effective urban speeds (km/h) per mode and street class. Mock-tuned for London. */
function speedKmh(mode: TravelMode, kind: number): number {
  switch (mode) {
    case 'walk':
    case 'transit':
      return 4.8;
    case 'cycle':
      return kind === EDGE_MAJOR ? 15.5 : kind === EDGE_BRIDGE ? 14 : 12.5;
    case 'drive':
      return kind === EDGE_MAJOR ? 27 : kind === EDGE_BRIDGE ? 21 : 13;
  }
}

const PLATFORM_MINUTES = 1.5; // lobby <-> platform (so an interchange costs 3 min)
const STATION_ENTRY_MINUTES = 1.0; // street <-> lobby on top of the walk
const WALK_KMH = 4.8;

export interface ReachResult {
  /** minutes to reach each street node (UNREACHED if never) */
  nodeMin: Float32Array;
  /** minutes to reach each station lobby (transit mode only; UNREACHED otherwise) */
  stationMin: Float32Array;
  /** per street edge: minutes when the glow starts entering the edge */
  edgeT: Float32Array;
  /** per street edge: minutes to traverse it (glow ramp duration) */
  edgeDur: Float32Array;
}

/** simple binary min-heap keyed on distance */
class Heap {
  d: number[] = [];
  v: number[] = [];
  size = 0;
  push(dist: number, val: number) {
    let i = this.size++;
    this.d[i] = dist;
    this.v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      this.swap(i, p);
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
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(i: number, j: number) {
    const td = this.d[i];
    this.d[i] = this.d[j];
    this.d[j] = td;
    const tv = this.v[i];
    this.v[i] = this.v[j];
    this.v[j] = tv;
  }
}

/**
 * Dijkstra over the street graph. In transit mode the graph is extended with
 * station lobby nodes and per-(line,station) platform nodes, so the wavefront
 * genuinely travels station-to-station along each line and then walks back
 * out into the street network around every reached station.
 */
export function computeReach(
  city: CityModel,
  tube: TubeNetwork,
  origin: LngLat,
  mode: TravelMode,
): ReachResult {
  const N = city.nodes.length;
  const S = tube.stations.length;

  // platform node ids: one per (line, station-position)
  const platforms: Array<{ line: number; si: number }> = [];
  const platformId = new Map<string, number>();
  if (mode === 'transit') {
    tube.lines.forEach((line, li) => {
      line.stations.forEach((sid) => {
        const si = tube.stationIndex.get(sid)!;
        platformId.set(`${li}:${si}`, N + S + platforms.length);
        platforms.push({ line: li, si });
      });
    });
  }
  const total = N + (mode === 'transit' ? S + platforms.length : 0);

  type Arc = [to: number, minutes: number];
  const adj: Arc[][] = new Array(total);
  for (let i = 0; i < total; i++) adj[i] = [];

  for (const e of city.edges) {
    const min = (e.lenKm / speedKmh(mode, e.kind)) * 60;
    adj[e.a].push([e.b, min]);
    adj[e.b].push([e.a, min]);
  }

  if (mode === 'transit') {
    // station lobby <-> nearest street node
    tube.stations.forEach((st, si) => {
      const n = nearestNode(city, st.pos);
      if (n < 0) return;
      const dx = (city.nodes[n].x - st.pos[0]) * KM_PER_DEG_LNG;
      const dy = (city.nodes[n].y - st.pos[1]) * KM_PER_DEG_LAT;
      const walkMin = (Math.sqrt(dx * dx + dy * dy) / WALK_KMH) * 60;
      const cost = walkMin + STATION_ENTRY_MINUTES;
      adj[n].push([N + si, cost]);
      adj[N + si].push([n, cost]);
    });
    // lobby <-> platforms, platform hops along each line
    tube.lines.forEach((line, li) => {
      let prev = -1;
      for (const sid of line.stations) {
        const si = tube.stationIndex.get(sid)!;
        const pid = platformId.get(`${li}:${si}`)!;
        adj[N + si].push([pid, PLATFORM_MINUTES]);
        adj[pid].push([N + si, PLATFORM_MINUTES]);
        if (prev >= 0) {
          adj[prev].push([pid, line.hopMinutes]);
          adj[pid].push([prev, line.hopMinutes]);
        }
        prev = pid;
      }
    });
  }

  const dist = new Float64Array(total).fill(Infinity);
  const heap = new Heap();
  const start = nearestNode(city, origin);
  if (start >= 0) {
    const dx = (city.nodes[start].x - origin[0]) * KM_PER_DEG_LNG;
    const dy = (city.nodes[start].y - origin[1]) * KM_PER_DEG_LAT;
    const d0 = (Math.sqrt(dx * dx + dy * dy) / WALK_KMH) * 60;
    dist[start] = d0;
    heap.push(d0, start);
  }
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

  const nodeMin = new Float32Array(N);
  for (let i = 0; i < N; i++) nodeMin[i] = Number.isFinite(dist[i]) ? dist[i] : UNREACHED;

  const stationMin = new Float32Array(S).fill(UNREACHED);
  if (mode === 'transit') {
    for (let s = 0; s < S; s++) if (Number.isFinite(dist[N + s])) stationMin[s] = dist[N + s];
  }

  const E = city.edges.length;
  const edgeT = new Float32Array(E);
  const edgeDur = new Float32Array(E);
  for (let i = 0; i < E; i++) {
    const e = city.edges[i];
    const ta = nodeMin[e.a];
    const tb = nodeMin[e.b];
    const t = Math.min(ta, tb);
    edgeT[i] = t >= UNREACHED ? UNREACHED : t;
    edgeDur[i] = Math.max(0.35, (e.lenKm / speedKmh(mode, e.kind)) * 60);
  }
  return { nodeMin, stationMin, edgeT, edgeDur };
}
