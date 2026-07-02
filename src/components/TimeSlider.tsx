import { useMemo } from 'react';
import type { ModePalette } from '../map/palette';

interface Props {
  value: number;
  onChange(v: number): void;
  palette: ModePalette;
}

const TICKS = [10, 20, 30, 40, 50, 60];

export function TimeSlider({ value, onChange, palette }: Props) {
  const pct = ((value - 1) / 59) * 100;
  const fill = useMemo(
    () => `linear-gradient(90deg, ${palette.stops[0]}, ${palette.stops[1]} 45%, ${palette.stops[2]} 78%, ${palette.stops[3]})`,
    [palette],
  );

  return (
    <div className="w-full select-none" style={{ ['--accent' as string]: palette.accent }}>
      <div className="mb-1.5 flex items-end justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold leading-none text-white tabular-nums">{value}</span>
          <span className="text-sm text-white/50">min</span>
        </div>
        <span className="text-[11px] uppercase tracking-[0.18em] text-white/35">travel time</span>
      </div>

      <div className="relative h-8">
        {/* track */}
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
        {/* lit fill */}
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ width: `${pct}%`, background: fill, boxShadow: `0 0 12px 0 ${palette.accent}66` }}
        />
        <input
          type="range"
          min={1}
          max={60}
          step={1}
          value={value}
          aria-label="Travel time in minutes"
          onChange={(e) => onChange(Number(e.target.value))}
          className="glow-slider absolute inset-0 w-full"
        />
      </div>

      <div className="relative mt-0.5 h-4 text-[10px] font-medium text-white/30">
        {TICKS.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${((t - 1) / 59) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
