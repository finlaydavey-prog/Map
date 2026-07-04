import { COMPARE_A_STOPS, COMPARE_B_STOPS, LIKELIHOOD_STOPS, OVERLAP_COLOR } from './palette';

/**
 * Per-frame paint expressions. The current time T (minutes) is baked into the
 * expression tree and pushed with setPaintProperty each animation frame
 * (validate:false) — the GPU re-evaluates per feature, so the whole street
 * network animates with zero per-feature JS work.
 */

type E = unknown[] | number | string | boolean;

const clamp01 = (x: E): E => ['max', 0, ['min', 1, x]];

/** entry progress for one origin: 0 before reached, ramps over traversal */
const intensity = (t: string, d: string, T: number): E =>
  clamp01(['/', ['-', T, ['get', t]], ['max', 0.001, ['get', d]]]);

/** relative position inside the lit region: 0 at origin, 1 at the frontier */
const relDepth = (t: string, T: number): E => ['min', 1, ['/', ['get', t], Math.max(T, 0.001)]];

/** ramp over relative depth: stops[0] at the origin -> stops[3] at the frontier */
const gradient = (rVar: string, stops: [string, string, string, string]): E => [
  'interpolate',
  ['linear'],
  ['var', rVar],
  0,
  stops[0],
  0.45,
  stops[1],
  0.78,
  stops[2],
  1,
  stops[3],
];

export interface StreetPaint {
  color: E;
  opacity: E;
}

/**
 * Single origin: green -> red "will I make it" ramp.
 * Comparing: A blue, B orange, both-reachable medium light green.
 */
export function streetPaint(T: number, comparing: boolean): StreetPaint {
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
      ? [
          'case',
          both,
          OVERLAP_COLOR,
          ['>=', ['var', 'ia'], ['var', 'ib']],
          gradient('ra', COMPARE_A_STOPS),
          gradient('rb', COMPARE_B_STOPS),
        ]
      : gradient('ra', LIKELIHOOD_STOPS),
  );

  const opacity = bind(comparing ? ['max', ['var', 'ia'], ['var', 'ib']] : ['var', 'ia']);

  return { color, opacity };
}

/** progress of the ride across one transit sub-segment */
export function transitProgress(T: number): E {
  return clamp01(['/', ['-', T, ['get', 't0']], ['max', 0.001, ['-', ['get', 't1'], ['get', 't0']]]]);
}

export interface StationPaint {
  radius: E;
  opacity: E;
  strokeWidth: E;
}

export function stationPaint(T: number, zoomK: number): StationPaint {
  const u: E = ['-', T, ['get', 't']]; // minutes since reached
  const appear: E = clamp01(['/', u, 0.9]);
  const base: E = ['+', 2.4, ['*', 1.6, ['get', 'interchange']]];
  // overshoot pop when a station is first reached
  const pop: E = ['interpolate', ['linear'], u, 0, 0, 0.45, 1.45, 1.3, 1];
  return {
    radius: ['*', base, zoomK, pop],
    opacity: appear,
    // every reached station gets a ring (white fill needs it); interchanges heavier
    strokeWidth: ['*', ['+', 1.1, ['*', 0.9, ['get', 'interchange']]], zoomK, appear],
  };
}
