import { useEffect, useState } from 'react';
import type { AccessMode, JourneyOptions, TransitMethod } from '../lib/types';
import { BikeIcon, WalkIcon } from './icons';

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

/**
 * Minutes input that tolerates editing: the box may be blank while typing
 * (nothing is forced to 0) and NOTHING commits per keystroke — the value is
 * applied on blur or Enter. Blank/invalid input reverts to the last good
 * value; out-of-range numbers clamp.
 */
function MinutesBox({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit(v: number): void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // reflect outside changes (URL load, revert) while not editing
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const n = Number(text);
    if (text === '' || !Number.isFinite(n)) {
      setText(String(value)); // revert, never force 0
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(clamped));
    onCommit(clamped);
  };

  return (
    <span className="flex items-baseline gap-1">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-10 bg-transparent text-right font-mono text-sm font-semibold text-slate-900 outline-none tabular-nums"
        aria-label="Maximum access time in minutes"
      />
      <span className="text-[10px] text-slate-400">min</span>
    </span>
  );
}

export function NetworkControls({ options, onChange }: Props) {
  const toggle = (key: TransitMethod) =>
    onChange({ ...options, methods: { ...options.methods, [key]: !options.methods[key] } });
  const setAccess = (access: AccessMode) => onChange({ ...options, access });

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

      {/* access mode: walk OR cycle, one shared time budget */}
      <div className="flex items-center gap-2 rounded-xl bg-slate-900/[0.04] px-2 py-1.5 ring-1 ring-slate-900/10">
        <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-900/10">
          {(['walk', 'cycle'] as AccessMode[]).map((m) => {
            const on = options.access === m;
            const Icon = m === 'walk' ? WalkIcon : BikeIcon;
            return (
              <button
                key={m}
                onClick={() => setAccess(m)}
                aria-pressed={on}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                  on ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {m}
              </button>
            );
          })}
        </div>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Max</span>
          <MinutesBox
            value={options.maxAccessMin}
            min={1}
            max={60}
            onCommit={(v) => onChange({ ...options, maxAccessMin: v })}
          />
        </span>
      </div>
    </div>
  );
}
