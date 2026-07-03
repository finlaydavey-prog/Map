import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapView, type MapViewHandle } from './components/MapView';
import { ModeToggle } from './components/ModeToggle';
import { SearchBox } from './components/SearchBox';
import { StatCard } from './components/StatCard';
import { TimeSlider } from './components/TimeSlider';
import { Toasts, type Toast } from './components/Toasts';
import { LinkIcon, PlusIcon, XIcon } from './components/icons';
import { LIVE, MAPBOX_TOKEN } from './lib/config';
import { mapboxGeocode } from './lib/live/geocode';
import { searchPlaces } from './lib/mock/places';
import { TFL_COLOURS } from './lib/mock/tube';
import type { LiveStats } from './map/engine';
import { PALETTE_B, PALETTES } from './map/palette';
import type { LngLat, TravelMode } from './lib/types';
import { readShareState, writeShareState } from './lib/url';

const DEFAULT_ORIGIN: LngLat = [-0.1337, 51.5136]; // Soho

const searchProvider = LIVE
  ? (q: string) => mapboxGeocode(MAPBOX_TOKEN!, q)
  : async (q: string) => searchPlaces(q);

const TRANSIT_LEGEND: Array<[string, string]> = [
  ['Central', TFL_COLOURS.central],
  ['Victoria', TFL_COLOURS.victoria],
  ['Jubilee', TFL_COLOURS.jubilee],
  ['Elizabeth', TFL_COLOURS.elizabeth],
];

export default function App() {
  const initial = useRef(readShareState());
  const [originA, setOriginA] = useState<LngLat>(initial.current.originA ?? DEFAULT_ORIGIN);
  const [originB, setOriginB] = useState<LngLat | null>(initial.current.originB ?? null);
  const [mode, setMode] = useState<TravelMode>(initial.current.mode ?? 'transit');
  const [minutes, setMinutes] = useState(initial.current.minutes ?? 25);
  const [compareArmed, setCompareArmed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stats, setStats] = useState<LiveStats>({
    minutes,
    streetsLit: 0,
    stationsReached: 0,
    areaKm2: 0,
    overlapStreets: 0,
    comparing: false,
    loading: true,
  });
  const mapRef = useRef<MapViewHandle>(null);
  const toastId = useRef(0);

  const toast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, message }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3600);
  }, []);

  useEffect(() => {
    writeShareState({ originA, originB, mode, minutes });
  }, [originA, originB, mode, minutes]);

  const handleMapClick = useCallback(
    (pos: LngLat) => {
      if (!mapRef.current?.isInsideDemoArea(pos)) {
        toast(LIVE ? 'That spot is outside Greater London.' : 'That spot is outside the prototype area — try central London.');
        return;
      }
      if (compareArmed) {
        setOriginB(pos);
        setCompareArmed(false);
      } else {
        setOriginA(pos);
      }
    },
    [compareArmed, toast],
  );

  const handleOriginDragged = useCallback(
    (which: 'a' | 'b', pos: LngLat) => {
      if (!mapRef.current?.isInsideDemoArea(pos)) {
        toast(LIVE ? 'Outside Greater London — snapping back.' : 'Outside the prototype area — snapping back.');
        // fresh array refs force the marker back to its previous spot
        if (which === 'a') setOriginA((p) => [...p] as LngLat);
        else setOriginB((p) => (p ? ([...p] as LngLat) : p));
        return;
      }
      if (which === 'a') setOriginA(pos);
      else setOriginB(pos);
    },
    [toast],
  );

  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link copied — origins, mode and time included.');
    } catch {
      toast('Could not copy — grab the link from the address bar.');
    }
  }, [toast]);

  const palette = PALETTES[mode];

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper font-display text-slate-900">
      <MapView
        ref={mapRef}
        originA={originA}
        originB={originB}
        mode={mode}
        minutes={minutes}
        onStats={setStats}
        onMapClick={handleMapClick}
        onOriginDragged={handleOriginDragged}
        onToast={toast}
      />

      <Toasts toasts={toasts} />

      {/* ---------------------------------------------------- control panel */}
      <div className="absolute left-3 right-3 top-3 z-10 sm:left-4 sm:right-auto sm:top-4 sm:w-72">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass space-y-3 rounded-2xl p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: palette.accent }} />
              <span className="text-sm font-bold tracking-[0.28em] text-slate-900">LUMEN</span>
            </div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">London</span>
          </div>

          <SearchBox
            search={searchProvider}
            onSelect={(p) => {
              setOriginA(p.pos);
              mapRef.current?.flyTo(p.pos);
            }}
          />

          <ModeToggle mode={mode} onChange={setMode} />

          <AnimatePresence>
            {mode === 'transit' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 pb-0.5">
                  {TRANSIT_LEGEND.map(([name, color]) => (
                    <span key={name} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span className="h-[3px] w-4 rounded-full" style={{ background: color }} />
                      {name}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-2">
            {originB === null ? (
              <button
                onClick={() => {
                  setCompareArmed((v) => !v);
                  if (!compareArmed) toast('Click the map to drop a second origin.');
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  compareArmed
                    ? 'bg-orange-100 text-orange-800 ring-1 ring-orange-400/60'
                    : 'bg-slate-900/[0.04] text-slate-600 ring-1 ring-slate-900/10 hover:text-slate-900'
                }`}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {compareArmed ? 'Click map…' : 'Compare'}
              </button>
            ) : (
              <button
                onClick={() => setOriginB(null)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ring-1 ring-orange-400/60 transition"
                style={{ background: `${PALETTE_B.accent}1a`, color: PALETTE_B.stops[0] }}
              >
                <XIcon className="h-3.5 w-3.5" />
                Remove origin B
              </button>
            )}
            <button
              onClick={share}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900/[0.04] px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-900/10 transition hover:text-slate-900"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Share
            </button>
          </div>
        </motion.div>
      </div>

      {/* ------------------------------------------------------- stat card */}
      <div className="absolute right-4 top-4 z-10 hidden sm:block">
        <StatCard stats={stats} palette={palette} />
      </div>

      {/* ---------------------------------------------------------- slider */}
      <div className="absolute bottom-3 left-1/2 z-10 w-[min(680px,calc(100vw-1.5rem))] -translate-x-1/2 sm:bottom-5">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl px-5 pb-2 pt-3.5">
          <TimeSlider value={minutes} onChange={setMinutes} palette={palette} />
          <div className="border-t border-slate-900/[0.08] pt-2 sm:hidden">
            <StatCard stats={stats} palette={palette} compact />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
