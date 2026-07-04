import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapView, type MapViewHandle } from './components/MapView';
import { NetworkControls } from './components/NetworkControls';
import { SearchBox } from './components/SearchBox';
import { StatCard } from './components/StatCard';
import { TimeSlider } from './components/TimeSlider';
import { Toasts, type Toast } from './components/Toasts';
import { ChevronUpIcon, LinkIcon, PlusIcon, SlidersIcon, XIcon } from './components/icons';
import { LIVE, MAPBOX_TOKEN } from './lib/config';
import { mapboxGeocode } from './lib/live/geocode';
import { searchPlaces } from './lib/mock/places';
import { loadTransitLegend } from './lib/tube/load';
import type { LiveStats } from './map/engine';
import { ACCENT } from './map/palette';
import type { JourneyOptions, LngLat } from './lib/types';
import { DEFAULT_JOURNEY, RENDERED_TRANSIT } from './lib/types';
import { readShareState, writeShareState } from './lib/url';

const DEFAULT_ORIGIN: LngLat = [-0.1337, 51.5136]; // Soho

const searchProvider = LIVE
  ? (q: string) => mapboxGeocode(MAPBOX_TOKEN!, q)
  : async (q: string) => searchPlaces(q);

export default function App() {
  const initial = useRef(readShareState());
  const [originA, setOriginA] = useState<LngLat>(initial.current.originA ?? DEFAULT_ORIGIN);
  const [originB, setOriginB] = useState<LngLat | null>(initial.current.originB ?? null);
  const [minutes, setMinutes] = useState(initial.current.minutes ?? 25);
  const [options, setOptions] = useState<JourneyOptions>(initial.current.options ?? DEFAULT_JOURNEY);
  const [compareArmed, setCompareArmed] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [legend, setLegend] = useState<Array<[string, string, string]>>([]);
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

  useEffect(() => {
    loadTransitLegend().then(setLegend).catch(() => {});
  }, []);

  const toast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, message }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3600);
  }, []);

  useEffect(() => {
    writeShareState({ originA, originB, minutes, options });
  }, [originA, originB, minutes, options]);

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
      toast('Link copied — origins, networks and time included.');
    } catch {
      toast('Could not copy — grab the link from the address bar.');
    }
  }, [toast]);

  // legend shows only networks that are actually drawn (bus/rail work invisibly)
  const enabledLegend = legend.filter(
    ([, , mode]) =>
      RENDERED_TRANSIT.includes(mode as (typeof RENDERED_TRANSIT)[number]) &&
      options.methods[mode as keyof JourneyOptions['methods']],
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper font-display text-slate-900">
      <MapView
        ref={mapRef}
        originA={originA}
        originB={originB}
        minutes={minutes}
        options={options}
        onStats={setStats}
        onMapClick={handleMapClick}
        onOriginDragged={handleOriginDragged}
        onToast={toast}
      />

      <Toasts toasts={toasts} />

      {/* --------------------------------------------- collapsed panel pill */}
      <AnimatePresence>
        {panelsHidden && (
          <motion.button
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            onClick={() => setPanelsHidden(false)}
            title="Show controls"
            className="glass absolute left-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition hover:text-slate-900 sm:left-4 sm:top-4"
          >
            <SlidersIcon className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------- control panel */}
      {!panelsHidden && (
      <div className="absolute left-3 right-3 top-3 z-10 sm:left-4 sm:right-auto sm:top-4 sm:w-80">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass space-y-3 rounded-2xl p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: ACCENT }} />
              <span className="text-sm font-bold tracking-[0.28em] text-slate-900">LUMEN</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">London</span>
              <button
                onClick={() => setPanelsHidden(true)}
                title="Hide controls (slider stays)"
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-900/5 hover:text-slate-700"
              >
                <ChevronUpIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <SearchBox
            search={searchProvider}
            onSelect={(p) => {
              setOriginA(p.pos);
              mapRef.current?.flyTo(p.pos);
            }}
          />

          <NetworkControls options={options} onChange={setOptions} />

          {enabledLegend.length > 0 && (
            <div className="flex max-h-20 flex-wrap gap-x-2.5 gap-y-1 overflow-y-auto px-0.5 pb-0.5">
              {enabledLegend.map(([name, color]) => (
                <span key={name} className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span className="h-[3px] w-3.5 rounded-full" style={{ background: color }} />
                  {name.replace(' line', '')}
                </span>
              ))}
            </div>
          )}

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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-900 ring-1 ring-orange-400/60 transition"
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
      )}

      {/* ------------------------------------------------------- stat card */}
      {!panelsHidden && (
        <div className="absolute right-4 top-4 z-10 hidden sm:block">
          <StatCard stats={stats} />
        </div>
      )}

      {/* ---------------------------------------------------------- slider */}
      <div className="absolute bottom-3 left-1/2 z-10 w-[min(680px,calc(100vw-1.5rem))] -translate-x-1/2 sm:bottom-5">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl px-5 pb-2 pt-3.5">
          <TimeSlider value={minutes} onChange={setMinutes} />
          <div className="border-t border-slate-900/[0.08] pt-2 sm:hidden">
            <StatCard stats={stats} compact />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
