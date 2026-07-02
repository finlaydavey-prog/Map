import type { LngLat, TravelMode } from './types';
import { MODES } from './types';

export interface ShareState {
  originA: LngLat;
  originB: LngLat | null;
  mode: TravelMode;
  minutes: number;
}

const fmt = (p: LngLat) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`; // lat,lng

function parseLatLng(s: string | null): LngLat | null {
  if (!s) return null;
  const m = s.split(',').map(Number);
  if (m.length !== 2 || m.some((x) => !Number.isFinite(x))) return null;
  const [lat, lng] = m;
  if (lat < 51.3 || lat > 51.7 || lng < -0.4 || lng > 0.2) return null;
  return [lng, lat];
}

export function readShareState(): Partial<ShareState> {
  const q = new URLSearchParams(window.location.search);
  const out: Partial<ShareState> = {};
  const a = parseLatLng(q.get('o'));
  if (a) out.originA = a;
  const b = parseLatLng(q.get('o2'));
  if (b) out.originB = b;
  const mode = q.get('mode') as TravelMode | null;
  if (mode && MODES.includes(mode)) out.mode = mode;
  const t = Number(q.get('t'));
  if (Number.isFinite(t) && t >= 1 && t <= 60) out.minutes = Math.round(t);
  return out;
}

export function writeShareState(s: ShareState): void {
  const q = new URLSearchParams();
  q.set('o', fmt(s.originA));
  if (s.originB) q.set('o2', fmt(s.originB));
  q.set('mode', s.mode);
  q.set('t', String(s.minutes));
  window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
}
