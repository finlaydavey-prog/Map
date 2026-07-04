import type { LngLat } from '../types';

/**
 * Catmull-Rom sample of the curve between p1 and p2 (p0/p3 are the route's
 * neighbouring stations). Gives tube lines a gentle swing through stations
 * instead of hard point-to-point corners.
 */
export function curvedHop(p0: LngLat, p1: LngLat, p2: LngLat, p3: LngLat, samples = 8): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const t2 = t * t;
    const t3 = t2 * t;
    out.push([
      0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ]);
  }
  return out;
}

/** cumulative-length slice of a polyline between fractions f0..f1 of its arc length */
export function slicePolyline(line: LngLat[], f0: number, f1: number): LngLat[] {
  const seg: number[] = [0];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += Math.hypot(line[i][0] - line[i - 1][0], (line[i][1] - line[i - 1][1]) * 1.6);
    seg.push(total);
  }
  if (total === 0) return [line[0], line[line.length - 1]];
  const at = (f: number): LngLat => {
    const target = f * total;
    let i = 1;
    while (i < seg.length - 1 && seg[i] < target) i++;
    const span = seg[i] - seg[i - 1] || 1;
    const k = (target - seg[i - 1]) / span;
    return [
      line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k,
      line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k,
    ];
  };
  const out: LngLat[] = [at(f0)];
  for (let i = 0; i < seg.length; i++) {
    const f = seg[i] / total;
    if (f > f0 && f < f1) out.push(line[i]);
  }
  out.push(at(f1));
  return out;
}
