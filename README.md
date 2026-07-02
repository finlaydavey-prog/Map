# Lumen — Commutable Distance Map (London)

Watch London light up. Drop a beacon, drag the time slider, and individual
streets illuminate outward through the road network — electric cyan near the
origin, fading to magenta at the edge of reachability. In transit mode the
tube lines (official TfL colours) act as arteries: the glow travels
station-to-station along each line, then blooms into the streets around every
reached station.

**This is the mock-data prototype.** It runs with zero API keys so the
signature animation, 1-minute slider interpolation, transit spread and visual
style can be reviewed and tuned before wiring in real providers. Everything
except the data source already behaves like the final product.

## Run it

```bash
npm install
npm run dev        # open the printed localhost URL
npm run build      # type-check + production bundle
```

## What's in the prototype

- **1–60 min slider, 1-minute granularity.** Slider movement is 100%
  client-side: the current time is smoothed each animation frame and baked
  into GPU paint expressions (`setPaintProperty`, `validate:false`), so the
  whole network re-evaluates per-feature on the GPU with zero per-street JS.
  Dragging down retracts the glow the same way.
- **Street-by-street spread.** Every street segment carries a reach time
  (minutes) and a traversal duration; glow intensity ramps in over the
  traversal, brightness falls off toward the frontier, and the outer ~12%
  shimmers.
- **Transit mode.** Central, Victoria, Jubilee and Elizabeth lines in
  official TfL colours. Station-to-station hops are subdivided so the glow
  visibly crawls along the line; stations pop in as glowing dots (interchanges
  get a ring); line segments beyond the reachable time stay dimmed. The street
  glow keeps the cyan→magenta time gradient so the two systems read
  distinctly.
- **Compare two origins.** Origin B renders in warm amber; streets reached by
  both within the budget render white-hot. A "shared streets" stat appears.
- **Live stats** (streets lit, stations, area km², shared streets) update
  continuously with the slider from precomputed per-minute cumulative
  histograms — O(1) per frame.
- **Shareable URLs**: `?o=lat,lng&o2=lat,lng&mode=transit&t=25`.
- **Loading choreography**: the beacon pulses alone in the dark city while
  bands "arrive" (simulated latency), then the glow blooms outward in a sweep.
- **Mobile**: controls collapse into a bottom sheet with a compact stat row;
  coarse-pointer devices get half-rate expression updates (same visuals).
- Errors (clicks outside the demo area, clipboard failures) surface as inline
  glass toasts — never browser alerts.

## Mock data

| Real thing | Mock stand-in |
| --- | --- |
| Mapbox vector-tile streets | Seeded procedural street graph (~7k segments) over central London, with the Thames, its bridges and the royal parks carved out |
| Mapbox Isochrone API (drive/walk/cycle) | `MockIsochroneProvider` — Dijkstra over the street graph, returned as 6 contour rings after simulated latency |
| Transit isochrones (Geoapify / TfL) | Same provider; the graph is extended with station lobby + platform nodes, per-line hop times and interchange penalties |
| TfL line/station geometry | Hand-coded stations (approximate real coordinates) for 4 lines, official TfL colours (`src/lib/mock/tube.ts` carries the full colour table) |
| Mapbox Geocoding | Fuzzy search over ~24 London places |
| Mapbox GL JS + dark style | MapLibre GL (API-compatible fork) over a self-contained dark style — no token, no tiles, fully offline |

## Architecture (and how the real APIs plug in)

```
src/lib/types.ts             IsochroneProvider interface + shared types
src/lib/providers/isochrone.ts  MockIsochroneProvider + notes for Mapbox/Geoapify/TfL
src/lib/reach.ts             Dijkstra over streets (+ transit graph in transit mode)
src/lib/bands.ts             contour rings <-> radial profiles; 1-min interpolation
src/lib/mock/                city grid, tube lines, geocoder places
src/map/engine.ts            rAF loop, reveal sweep, paint updates, stats histograms
src/map/expressions.ts       per-frame GPU paint expressions (the glow math)
src/map/palette.ts           per-mode palettes, amber compare palette, TfL colours
src/components/              glass UI: slider, mode toggle, stats, search, toasts
```

The swap plan, per the provider contract in `types.ts`:

1. **Drive / walk / cycle** → `MapboxIsochroneProvider` hitting the Isochrone
   API at 6 coarse bands (4 contours max per request → 2 batched requests),
   cached by `(origin, mode, bands)`. The existing
   `profilesFromRings` + `profileAt` machinery already interpolates any
   1-minute step between bands; street segments then take their reach time
   from the interpolated frontier instead of the mock graph.
2. **Transit** → either Geoapify's `approximated_transit` isolines, or (better
   fit for the station-by-station animation) TfL Unified API journey times
   between stations + walking bloom around reached stations — which is
   exactly the graph shape the mock already computes, so the renderer needs
   no changes.
3. **Map** → replace `maplibre-gl` with `mapbox-gl` + the dark style, and feed
   street geometry from vector tiles (feature-state per street) instead of the
   bundled GeoJSON. Paint expressions carry over unchanged.
4. Keys go in `.env` (see `.env.example`); nothing is hardcoded.

## Tuning knobs

- `REVEAL_MINUTES_PER_SEC`, `SMOOTH_TAU` — bloom sweep speed / slider tracking
  feel (`src/map/engine.ts`).
- Glow widths/opacities and the shimmer band — `src/map/expressions.ts`.
- Mode speeds, station entry/interchange penalties — `src/lib/reach.ts`.
- Palettes — `src/map/palette.ts`.
