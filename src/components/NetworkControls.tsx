import type { JourneyOptions, TransitMethod } from '../lib/types';

interface MethodChip {
  key: TransitMethod | 'bus' | 'rail';
  label: string;
  color: string;
  soon?: boolean;
}

const CHIPS: MethodChip[] = [
  { key: 'tube', label: 'Tube', color: '#113b92' },
  { key: 'elizabeth-line', label: 'Elizabeth', color: '#6950a1' },
  { key: 'dlr', label: 'DLR', color: '#00a4a7' },
  { key: 'overground', label: 'Overground', color: '#ee7c0e' },
  { key: 'bus', label: 'Bus', color: '#dc241f', soon: true },
  { key: 'rail', label: 'Rail', color: '#5d6062', soon: true },
];

interface Props {
  options: JourneyOptions;
  onChange(options: JourneyOptions): void;
}

function NumberBox({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
}) {
  return (
    <label className="flex flex-1 items-center justify-between gap-2 rounded-xl bg-slate-900/[0.04] px-2.5 py-1.5 ring-1 ring-slate-900/10">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="flex items-baseline gap-1">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          className="w-10 bg-transparent text-right font-mono text-sm font-semibold text-slate-900 outline-none tabular-nums"
        />
        <span className="text-[10px] text-slate-400">min</span>
      </span>
    </label>
  );
}

export function NetworkControls({ options, onChange }: Props) {
  const toggle = (key: TransitMethod) =>
    onChange({ ...options, methods: { ...options.methods, [key]: !options.methods[key] } });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((chip) => {
          if (chip.soon) {
            return (
              <span
                key={chip.key}
                title="Coming soon"
                className="flex cursor-not-allowed items-center gap-1.5 rounded-full bg-slate-900/[0.03] px-2.5 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-slate-900/[0.06]"
              >
                <span className="h-2 w-2 rounded-full opacity-30" style={{ background: chip.color }} />
                {chip.label}
                <span className="text-[8px] font-bold uppercase tracking-wider text-slate-300">soon</span>
              </span>
            );
          }
          const on = options.methods[chip.key as TransitMethod];
          return (
            <button
              key={chip.key}
              onClick={() => toggle(chip.key as TransitMethod)}
              aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
                on ? 'bg-white text-slate-900 shadow-sm' : 'bg-slate-900/[0.04] text-slate-400 ring-slate-900/10'
              }`}
              style={on ? { boxShadow: `inset 0 0 0 1.5px ${chip.color}`, borderColor: chip.color } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: chip.color, opacity: on ? 1 : 0.35 }} />
              {chip.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <NumberBox
          label="Max walk"
          value={options.maxWalkMin}
          min={1}
          max={60}
          onChange={(v) => onChange({ ...options, maxWalkMin: v })}
        />
        <NumberBox
          label="Max cycle"
          value={options.maxCycleMin}
          min={0}
          max={60}
          onChange={(v) => onChange({ ...options, maxCycleMin: v })}
        />
      </div>
    </div>
  );
}
