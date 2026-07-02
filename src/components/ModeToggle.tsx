import { motion } from 'framer-motion';
import type { TravelMode } from '../lib/types';
import { MODES } from '../lib/types';
import { PALETTES } from '../map/palette';
import { BikeIcon, CarIcon, TransitIcon, WalkIcon } from './icons';

const ICONS: Record<TravelMode, typeof CarIcon> = {
  drive: CarIcon,
  transit: TransitIcon,
  walk: WalkIcon,
  cycle: BikeIcon,
};

interface Props {
  mode: TravelMode;
  onChange(mode: TravelMode): void;
}

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="flex gap-1 rounded-xl bg-slate-900/[0.05] p-1">
      {MODES.map((m) => {
        const Icon = ICONS[m];
        const active = m === mode;
        const accent = PALETTES[m].accent;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            title={PALETTES[m].label}
            aria-pressed={active}
            className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 transition-colors ${
              active ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {active && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 rounded-lg bg-white"
                style={{ boxShadow: `inset 0 0 0 1.5px ${accent}, 0 1px 4px rgba(30,34,44,0.12)` }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <motion.span
              animate={active ? { scale: [1, 1.25, 1] } : { scale: 1 }}
              transition={{ duration: 0.35 }}
              className="relative"
              style={active ? { color: accent } : undefined}
            >
              <Icon className="h-5 w-5" />
            </motion.span>
            <span className="relative text-[9px] font-medium uppercase tracking-wider">{PALETTES[m].label}</span>
          </button>
        );
      })}
    </div>
  );
}
