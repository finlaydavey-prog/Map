import { AnimatePresence, motion } from 'framer-motion';
import type { LiveStats } from '../map/engine';
import type { ModePalette } from '../map/palette';
import { PALETTE_B } from '../map/palette';

interface Props {
  stats: LiveStats;
  palette: ModePalette;
  compact?: boolean;
}

function Row({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums text-slate-900" style={accent ? { color: accent } : undefined}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-slate-400">{unit}</span>}
      </span>
    </div>
  );
}

export function StatCard({ stats, palette, compact }: Props) {
  const fmt = (n: number) => n.toLocaleString('en-GB');
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-slate-500">
        <span>
          <b className="text-slate-900">{fmt(stats.streetsLit)}</b> streets
        </span>
        {stats.stationsReached > 0 && (
          <span>
            <b className="text-slate-900">{stats.stationsReached}</b> stations
          </span>
        )}
        <span>
          <b className="text-slate-900">{stats.areaKm2.toFixed(1)}</b> km²
        </span>
        {stats.comparing && (
          <span style={{ color: PALETTE_B.accent }}>
            <b>{fmt(stats.overlapStreets)}</b> shared
          </span>
        )}
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass w-56 space-y-2.5 rounded-2xl p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">Reach</span>
        <AnimatePresence>
          {stats.loading && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-[10px] text-slate-500"
            >
              <span className="h-1.5 w-1.5 animate-ping rounded-full" style={{ background: palette.accent }} />
              updating
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <Row label="Streets lit" value={fmt(stats.streetsLit)} />
      {stats.stationsReached > 0 && <Row label="Stations" value={String(stats.stationsReached)} />}
      <Row label="Area" value={stats.areaKm2 >= 100 ? stats.areaKm2.toFixed(0) : stats.areaKm2.toFixed(1)} unit="km²" />
      {stats.comparing && <Row label="Shared streets" value={fmt(stats.overlapStreets)} accent={PALETTE_B.accent} />}
    </motion.div>
  );
}
