import type { TravelMode } from '../lib/types';

export interface ModePalette {
  /** UI accent (dark enough for text/icons on the light map) */
  accent: string;
  /** street colour ramp, near origin -> reachability edge (dark -> light) */
  stops: [string, string, string, string];
  label: string;
}

/** Origin A: one sequential hue per mode; nearest streets darkest. */
export const PALETTES: Record<TravelMode, ModePalette> = {
  drive: { accent: '#1a56c4', stops: ['#0d2f7e', '#1a56c4', '#5c8ef0', '#b7cdf8'], label: 'Driving' },
  transit: { accent: '#5e35b1', stops: ['#3b1e77', '#5e35b1', '#9575cd', '#d5c6ee'], label: 'Transit' },
  walk: { accent: '#1b7f4d', stops: ['#0b4d33', '#1b7f4d', '#57b884', '#b5e2ca'], label: 'Walking' },
  cycle: { accent: '#0e8785', stops: ['#07504f', '#0e8785', '#4db6ac', '#b2ded9'], label: 'Cycling' },
};

/** Origin B: warm orange, always — the contrast IS the compare feature. */
export const PALETTE_B: ModePalette = {
  accent: '#d95f02',
  stops: ['#8a3800', '#c2571a', '#ef8a3c', '#f9cf9d'],
  label: 'Origin B',
};

/** Overlap of A and B: a deep violet that reads on the light map. */
export const OVERLAP_COLOR = '#5b2a86';

export const COLORS = {
  bg: '#f5f3ec',
  water: '#bcd7ee',
  park: '#cfe6c6',
  streetDim: '#dedcd2',
  streetDimMajor: '#d2d0c4',
  stationDim: '#c7c7bf',
  stationStroke: '#31373d',
  casing: '#ffffff',
};
