import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type Place } from '../lib/mock/places';
import { SearchIcon } from './icons';

interface Props {
  onSelect(place: Place): void;
}

export function SearchBox({ onSelect }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const results = searchPlaces(q);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (p: Place) => {
    onSelect(p);
    setQ(p.name);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-2 rounded-xl bg-slate-900/[0.04] px-3 py-2 ring-1 ring-slate-900/10 transition focus-within:ring-slate-900/30">
        <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter' && results[highlight]) {
              pick(results[highlight]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="Search London…"
          className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 outline-none"
        />
      </div>
      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="glass absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl py-1"
          >
            {results.map((p, i) => (
              <li key={p.name}>
                <button
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(p)}
                  className={`flex w-full items-baseline justify-between px-3 py-1.5 text-left text-sm ${
                    i === highlight ? 'bg-slate-900/5 text-slate-900' : 'text-slate-600'
                  }`}
                >
                  <span>{p.name}</span>
                  <span className="text-[10px] text-slate-400">{p.hint}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
