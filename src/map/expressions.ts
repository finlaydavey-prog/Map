import type { ModePalette } from './palette';
import { OVERLAP_COLOR } from './palette';

/**
 * Per-frame paint expressions. The current time T (minutes) and shimmer phase
 * are baked into the expression tree and pushed with setPaintProperty each
 * animation frame (validate:false) — the GPU re-evaluates per feature, so the
 * whole street network animates with zero per-feature JS work.
 */

type E = unknown[] | number | string | boolean;

const clamp01 = (x: E): E => ['max', 0, ['min', 1, x]];

/** glow entry progress for one origin: 0 before reached, ramps over traversal */
const intensity = (t: string, d: string, T: number): E =>
  clamp01(['/', ['-', T, ['get', t]], ['max', 0.001, ['get', d]]]);

/** relative position inside the lit region: 0 at origin, 1 at the frontier */
const relDepth = (t: string, T: number): E => ['min', 1, ['/', ['get', t], Math.max(T, 0.001)]];

const gradient = (rVar: string, pal: ModePalette): E => [
  'interpolate',
  ['linear'],
  ['var', rVar],
  0,
  pal.stops[0],
  0.42,
  pal.stops[1],
  0.74,
  pal.stops[2],
  1,
  pal.stops[3],
];

/** frontier shimmer: features within the outer ~12% of the reach flicker */
const shimmer = (rVar: string, tProp: string, phase: number): E => [
  '-',
  1,
  [
    '*',
    ['*', 0.55, ['max', 0, ['/', ['-', ['var', rVar], 0.86], 0.14]]],
    ['+', 0.5, ['*', 0.5, ['sin', ['+', phase, ['*', ['get', tProp], 6.7]]]]],
  ],
];

export interface StreetPaint {
  color: E;
  coreOpacity: E;
  glowOpacity: E;
}

export function streetPaint(
  T: number,
  phase: number,
  palA: ModePalette,
  palB: ModePalette,
  comparing: boolean,
): StreetPaint {
  const bind = (body: E): E => [
    'let',
    'ia',
    intensity('ta', 'da', T),
    'ib',
    comparing ? intensity('tb', 'db', T) : 0,
    'ra',
    relDepth('ta', T),
    'rb',
    comparing ? relDepth('tb', T) : 1,
    body,
  ];

  const both: E = ['all', ['>', ['var', 'ia'], 0.05], ['>', ['var', 'ib'], 0.05]];

  const color = bind(
    comparing
      ? ['case', both, OVERLAP_COLOR, ['>=', ['var', 'ia'], ['var', 'ib']], gradient('ra', palA), gradient('rb', palB)]
      : gradient('ra', palA),
  );

  // brightness: full glow near the origin, fading + shimmering at the edge
  const litA: E = ['*', ['var', 'ia'], ['-', 1, ['*', 0.45, ['var', 'ra']]], shimmer('ra', 'ta', phase)];
  const litB: E = ['*', ['var', 'ib'], ['-', 1, ['*', 0.45, ['var', 'rb']]], shimmer('rb', 'tb', phase + 2.1)];
  const lit: E = comparing
    ? ['min', 1, ['+', ['max', litA, litB], ['case', both, ['*', 0.35, ['min', ['var', 'ia'], ['var', 'ib']]], 0]]]
    : litA;

  // widths stay static (set once at layer creation): only color + opacity are
  // re-evaluated per frame, which keeps the CPU side of the animation cheap
  return {
    color,
    coreOpacity: bind(['*', 0.96, lit]),
    glowOpacity: bind(['*', 0.38, lit]),
  };
}

export interface TransitPaint {
  coreOpacity: E;
  glowOpacity: E;
}

/** progress of the ride across one sub-segment */
export function transitPaint(T: number): TransitPaint {
  const p: E = clamp01(['/', ['-', T, ['get', 't0']], ['max', 0.001, ['-', ['get', 't1'], ['get', 't0']]]]);
  return {
    coreOpacity: ['*', 0.98, p],
    glowOpacity: ['*', 0.5, p],
  };
}

export interface StationPaint {
  radius: E;
  opacity: E;
  haloRadius: E;
  haloOpacity: E;
  strokeWidth: E;
}

export function stationPaint(T: number, zoomK: number): StationPaint {
  const u: E = ['-', T, ['get', 't']]; // minutes since reached
  const appear: E = clamp01(['/', u, 0.9]);
  const base: E = ['+', 2.6, ['*', 1.7, ['get', 'interchange']]];
  // overshoot pop when a station is first reached
  const pop: E = ['interpolate', ['linear'], u, 0, 0, 0.45, 1.45, 1.3, 1];
  return {
    radius: ['*', base, zoomK, pop],
    opacity: appear,
    haloRadius: ['*', base, zoomK, pop, 3.1],
    haloOpacity: ['*', 0.4, appear],
    strokeWidth: ['*', ['get', 'interchange'], 1.4, appear],
  };
}
