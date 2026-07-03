import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Place } from '../lib/mock/places';
import { SearchIcon } from './icons';

interface Props {
  onSelect(place: Place): void;
  /** async search provider (mock fuzzy list or Mapbox Geocoding) */
  search(q: string): Promise<Place[]>;
}

export function SearchBox({ onSelect, search }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryId = useRef(0);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const runSearch = (value: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    const id = ++queryId.current;
    debounce.current = setTimeout(async () => {
      try {
        const r = await search(value);
        if (id === queryId.current) {
          setResults(r);
          setHighlight(0);
        }
      } catch {
        if (id === queryId.current) setResults([]);
      }
    }, 220);
  };

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
            runSearch(e.target.value);
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
              <li key={`${p.name}:${p.pos[0]}:${p.pos[1]}`}>
                <button
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(p)}
                  className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                    i === highlight ? 'bg-slate-900/5 text-slate-900' : 'text-slate-600'
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 truncate text-[10px] text-slate-400">{p.hint}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
