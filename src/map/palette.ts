/** UI accent (beacons, slider thumb, chips) */
export const ACCENT = '#5e35b1';

/**
 * Single-origin street ramp: likelihood of making it within the budget.
 * Green (comfortably reachable) -> amber -> red right at the frontier.
 */
export const LIKELIHOOD_STOPS: [string, string, string, string] = ['#188a42', '#8ab823', '#eaa221', '#d64040'];

/** Compare mode: origin A cool blue, origin B warm orange. */
export const COMPARE_A_STOPS: [string, string, string, string] = ['#0f3d8f', '#2563c9', '#5b8ee8', '#b7cdf8'];
export const COMPARE_B_STOPS: [string, string, string, string] = ['#8a3800', '#c2571a', '#ef8a3c', '#f9cf9d'];
export const COMPARE_A_ACCENT = '#2563c9';
export const COMPARE_B_ACCENT = '#d95f02';

/** Streets reachable from BOTH origins within the budget. */
export const OVERLAP_COLOR = '#66bb6a';

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
