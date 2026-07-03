import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from '../geo';
import type { LngLat, TubeNetwork } from '../types';

/**
 * Station reach times without the mock street graph: walk straight to any
 * station (detour-corrected), then ride hop-by-hop with interchange
 * penalties. This is exactly the shape the real TfL Journey Planner data
 * will slot into later — swap the hop times for API journey times.
 */

const WALK_KMH = 4.8;
const DETOUR = 1.35;
const STATION_ENTRY_MIN = 2.5; // enter + reach platform
const INTERCHANGE_MIN = 3.5;
const STATION_EXIT_MIN = 1.0;

export function computeTransitStationTimes(tube: TubeNetwork, origin: LngLat): Float32Array {
  const S = tube.stations.length;
  // platform node per (line, station); lobby node per station
  const platforms: Array<{ line: number; si: number }> = [];
  const pid = new Map<string, number>();
  tube.lines.forEach((line, li) => {
    line.stations.forEach((sid) => {
      const si = tube.stationIndex.get(sid)!;
      pid.set(`${li}:${si}`, S + platforms.length);
      platforms.push({ line: li, si });
    });
  });
  const total = S + platforms.length;
  const adj: Array<Array<[number, number]>> = Array.from({ length: total }, () => []);

  tube.lines.forEach((line, li) => {
    let prev = -1;
    for (const sid of line.stations) {
      const si = tube.stationIndex.get(sid)!;
      const p = pid.get(`${li}:${si}`)!;
      // lobby <-> platform: half the interchange each way
      adj[si].push([p, INTERCHANGE_MIN / 2]);
      adj[p].push([si, INTERCHANGE_MIN / 2]);
      if (prev >= 0) {
        adj[prev].push([p, line.hopMinutes]);
        adj[p].push([prev, line.hopMinutes]);
      }
      prev = p;
    }
  });

  const dist = new Float64Array(total).fill(Infinity);
  // seed: walk from origin to every station lobby
  const queue: Array<[number, number]> = [];
  tube.stations.forEach((s, si) => {
    const dx = (s.pos[0] - origin[0]) * KM_PER_DEG_LNG;
    const dy = (s.pos[1] - origin[1]) * KM_PER_DEG_LAT;
    const walk = ((Math.sqrt(dx * dx + dy * dy) * DETOUR) / WALK_KMH) * 60;
    const d = walk + STATION_ENTRY_MIN;
    if (d < dist[si]) {
      dist[si] = d;
      queue.push([d, si]);
    }
  });

  // small graph: array-based Dijkstra is plenty
  queue.sort((a, b) => a[0] - b[0]);
  const settled = new Uint8Array(total);
  while (queue.length > 0) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, u] = queue.shift()!;
    if (settled[u] || d > dist[u]) continue;
    settled[u] = 1;
    for (const [v, w] of adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        queue.push([nd, v]);
      }
    }
  }

  const out = new Float32Array(S);
  for (let si = 0; si < S; si++) out[si] = dist[si] + STATION_EXIT_MIN;
  return out;
}
