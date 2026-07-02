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
      <span className="text-[11px] uppercase tracking-[0.14em] text-white/40">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums text-white" style={accent ? { color: accent, textShadow: `0 0 12px ${accent}55` } : undefined}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-white/40">{unit}</span>}
      </span>
    </div>
  );
}

export function StatCard({ stats, palette, compact }: Props) {
  const fmt = (n: number) => n.toLocaleString('en-GB');
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-white/70">
        <span>
          <b className="text-white">{fmt(stats.streetsLit)}</b> streets
        </span>
        {stats.stationsReached > 0 && (
          <span>
            <b className="text-white">{stats.stationsReached}</b> stations
          </span>
        )}
        <span>
          <b className="text-white">{stats.areaKm2.toFixed(1)}</b> km²
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
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">Reach</span>
        <AnimatePresence>
          {stats.loading && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-[10px] text-white/45"
            >
              <span className="h-1.5 w-1.5 animate-ping rounded-full" style={{ background: palette.accent }} />
              charging
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
