import type { JourneyOptions, LngLat, TransitMethod } from './types';
import { DEFAULT_JOURNEY } from './types';

export interface ShareState {
  originA: LngLat;
  originB: LngLat | null;
  minutes: number;
  options: JourneyOptions;
}

const METHODS: TransitMethod[] = ['tube', 'elizabeth-line', 'dlr', 'overground'];
const fmt = (p: LngLat) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`; // lat,lng

function parseLatLng(s: string | null): LngLat | null {
  if (!s) return null;
  const m = s.split(',').map(Number);
  if (m.length !== 2 || m.some((x) => !Number.isFinite(x))) return null;
  const [lat, lng] = m;
  if (lat < 51.3 || lat > 51.7 || lng < -0.4 || lng > 0.2) return null;
  return [lng, lat];
}

const clampInt = (v: string | null, lo: number, hi: number): number | null => {
  if (v === null || v.trim() === '') return null; // absent param, not zero
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};

export function readShareState(): Partial<ShareState> {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(window.location.search);
  } catch {
    return {}; // sandboxed embeds may not expose a real location
  }
  const out: Partial<ShareState> = {};
  const a = parseLatLng(q.get('o'));
  if (a) out.originA = a;
  const b = parseLatLng(q.get('o2'));
  if (b) out.originB = b;
  const t = clampInt(q.get('t'), 1, 60);
  if (t !== null) out.minutes = t;

  // legacy params (mw/mc) map onto the single access choice
  const legacyCycle = clampInt(q.get('mc'), 1, 60);
  const access = q.get('am') === 'cycle' || legacyCycle !== null ? 'cycle' : 'walk';
  const options: JourneyOptions = {
    methods: { ...DEFAULT_JOURNEY.methods },
    access,
    maxAccessMin:
      clampInt(q.get('mx'), 1, 60) ??
      (access === 'cycle' ? legacyCycle : clampInt(q.get('mw'), 1, 60)) ??
      DEFAULT_JOURNEY.maxAccessMin,
  };
  const nets = q.get('nets');
  if (nets !== null) {
    const on = new Set(nets.split(',').filter(Boolean));
    for (const m of METHODS) options.methods[m] = on.has(m);
  }
  out.options = options;
  return out;
}

export function writeShareState(s: ShareState): void {
  const q = new URLSearchParams();
  q.set('o', fmt(s.originA));
  if (s.originB) q.set('o2', fmt(s.originB));
  q.set('t', String(s.minutes));
  q.set('nets', METHODS.filter((m) => s.options.methods[m]).join(','));
  q.set('am', s.options.access);
  q.set('mx', String(s.options.maxAccessMin));
  try {
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  } catch {
    // sandboxed embeds (e.g. hosted preview) may forbid history writes — fine,
    // the Share button still copies a usable URL via the clipboard
  }
}
