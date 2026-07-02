import type { TravelMode } from '../lib/types';

export interface ModePalette {
  /** UI accent */
  accent: string;
  /** street glow gradient, near origin -> reachability edge */
  stops: [string, string, string, string];
  label: string;
}

/** Origin A: cool neon per mode. */
export const PALETTES: Record<TravelMode, ModePalette> = {
  drive: { accent: '#4fe3ff', stops: ['#59f1ff', '#7c5cff', '#e44fff', '#ff3d9a'], label: 'Driving' },
  transit: { accent: '#9b7bff', stops: ['#6ce0ff', '#8a63d2', '#d94fff', '#ff3d9a'], label: 'Transit' },
  walk: { accent: '#5cffa3', stops: ['#5cffa3', '#4fe3ff', '#7c5cff', '#e44fff'], label: 'Walking' },
  cycle: { accent: '#c6ff4f', stops: ['#c6ff4f', '#4fe3ff', '#8a5cff', '#ff4fd8'], label: 'Cycling' },
};

/** Origin B: warm amber, always — the contrast IS the compare feature. */
export const PALETTE_B: ModePalette = {
  accent: '#ffb454',
  stops: ['#ffe9a3', '#ffc24f', '#ff8f3d', '#ff5c45'],
  label: 'Origin B',
};

/** Overlap of A and B renders white-hot. */
export const OVERLAP_COLOR = '#f6fbff';

export const COLORS = {
  bg: '#04050a',
  water: '#08111e',
  park: '#0a1210',
  streetDim: '#232c40',
  streetDimMajor: '#2c3750',
  stationDim: '#3a4258',
};
