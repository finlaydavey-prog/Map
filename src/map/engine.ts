import maplibregl from 'maplibre-gl';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { N_SPOKES, profileAt, profilesFromRings, ringFromProfile, type Profile } from '../lib/bands';
import { buildCity, distToNetworkKm } from '../lib/mock/city';
import { buildTube } from '../lib/mock/tube';
import { BAND_MINUTES, MockIsochroneProvider } from '../lib/providers/isochrone';
import { computeReach, UNREACHED, type ReachResult } from '../lib/reach';
import type { LngLat, TravelMode } from '../lib/types';
import {
  buildStationCollection,
  buildStreetCollection,
  buildTransitCollection,
  polygonFeature,
  updateTransitTimes,
  type StationProps,
  type StreetProps,
  type TransitSegProps,
} from './geojson';
import { stationPaint, streetPaint, transitProgress } from './expressions';
import { COLORS, PALETTE_B, PALETTES } from './palette';

export interface LiveStats {
  minutes: number;
  streetsLit: number;
  stationsReached: number;
  areaKm2: number;
  overlapStreets: number;
  comparing: boolean;
  loading: boolean;
}

export interface EngineCallbacks {
  onStats(stats: LiveStats): void;
  onMapClick(pos: LngLat): void;
  onOriginDragged(which: 'a' | 'b', pos: LngLat): void;
}

interface EngineState {
  originA: LngLat;
  originB: LngLat | null;
  mode: TravelMode;
  minutes: number;
}

const REVEAL_MINUTES_PER_SEC = 26; // bloom sweep speed after data arrives
const SMOOTH_TAU = 0.13; // slider-tracking time constant, seconds

function histogram(times: ArrayLike<number>, filter?: (i: number) => boolean): Float32Array {
  const cum = new Float32Array(62);
  for (let i = 0; i < times.length; i++) {
    if (filter && !filter(i)) continue;
    const t = times[i];
    if (t >= UNREACHED) continue;
    const bin = Math.min(61, Math.max(0, Math.ceil(t)));
    cum[bin]++;
  }
  for (let i = 1; i < 62; i++) cum[i] += cum[i - 1];
  return cum;
}

/** exponential zoom interpolation (base 1.6) across stops 10 -> 13 -> 16 */
function zoomLerp(z: number, at10: number, at13: number, at16: number): number {
  const seg = (z0: number, z1: number, v0: number, v1: number) => {
    const t = (Math.pow(1.6, z - z0) - 1) / (Math.pow(1.6, z1 - z0) - 1);
    return v0 + (v1 - v0) * Math.max(0, Math.min(1, t));
  };
  return z <= 13 ? seg(10, 13, at10, at13) : seg(13, 16, at13, at16);
}

function atMinute(cum: Float32Array | null, t: number): number {
  if (!cum) return 0;
  const lo = Math.min(61, Math.max(0, Math.floor(t)));
  const hi = Math.min(61, lo + 1);
  return cum[lo] + (cum[hi] - cum[lo]) * (t - lo);
}

export class GlowEngine {
  readonly map: maplibregl.Map;
  private city = buildCity();
  private tube = buildTube();
  private provider = new MockIsochroneProvider(this.city, this.tube);

  private streetFC: FeatureCollection<LineString, StreetProps>;
  private transitFC: FeatureCollection<LineString, TransitSegProps>;
  private stationFC: FeatureCollection<Point, StationProps>;

  private state: EngineState;
  private reachA: ReachResult | null = null;
  private reachB: ReachResult | null = null;
  private profilesA: Profile[] | null = null;
  private profilesB: Profile[] | null = null;

  private cumStreets: Float32Array | null = null;
  private cumShared: Float32Array | null = null;
  private cumStations: Float32Array | null = null;
  private cumNodes: Float32Array | null = null;

  private markerA: maplibregl.Marker;
  private markerB: maplibregl.Marker | null = null;

  private smoothT = 0;
  private revealStartMs = 0;
  private lastFrameMs = 0;
  private lastPaintT = -1;
  private generation = 0;
  private loading = false;
  private ready = false;
  private raf = 0;
  private frameCount = 0;
  private lastStatsKey = '';
  private destroyed = false;

  constructor(
    container: HTMLElement,
    initial: EngineState,
    private cb: EngineCallbacks,
  ) {
    this.state = { ...initial };
    this.streetFC = buildStreetCollection(this.city);
    this.transitFC = buildTransitCollection(this.tube);
    this.stationFC = buildStationCollection(this.tube);

    const [lngMin, latMin, lngMax, latMax] = this.city.bbox;
    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': COLORS.bg } }],
      },
      center: initial.originA,
      zoom: 12.1,
      minZoom: 10.4,
      maxZoom: 16.5,
      maxBounds: [
        [lngMin - 0.09, latMin - 0.05],
        [lngMax + 0.09, latMax + 0.05],
      ],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.getCanvas().style.cursor = 'crosshair';

    this.markerA = this.makeBeacon('a', initial.originA);

    this.map.on('click', (e) => this.cb.onMapClick([e.lngLat.lng, e.lngLat.lat]));
    // widths are zoom-dependent but computed in JS, so force a repaint on zoom
    this.map.on('zoom', () => {
      this.lastPaintT = -1;
    });
    this.map.on('load', () => {
      this.addLayers();
      this.ready = true;
      this.applyModeVisibility();
      this.recompute();
      this.lastFrameMs = performance.now();
      const loop = (now: number) => {
        if (this.destroyed) return;
        this.frame(now);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.map.remove();
  }

  isInsideDemoArea(pos: LngLat): boolean {
    return distToNetworkKm(this.city, pos) < 0.9;
  }

  flyTo(pos: LngLat): void {
    this.map.flyTo({ center: pos, zoom: Math.max(this.map.getZoom(), 12.2), speed: 1.4 });
  }

  /** React pushes desired state here; the engine diffs and reacts. */
  update(next: EngineState): void {
    const prev = this.state;
    this.state = { ...next };
    const originChanged =
      prev.originA[0] !== next.originA[0] ||
      prev.originA[1] !== next.originA[1] ||
      (prev.originB === null) !== (next.originB === null) ||
      (prev.originB && next.originB && (prev.originB[0] !== next.originB[0] || prev.originB[1] !== next.originB[1]));
    const modeChanged = prev.mode !== next.mode;

    if (next.originB && !this.markerB) this.markerB = this.makeBeacon('b', next.originB);
    if (!next.originB && this.markerB) {
      this.markerB.remove();
      this.markerB = null;
    }
    if (next.originB && this.markerB) this.markerB.setLngLat(next.originB);
    this.markerA.setLngLat(next.originA);
    this.markerA.getElement().style.setProperty('--beacon', PALETTES[next.mode].accent);

    if (this.ready && (originChanged || modeChanged)) {
      if (modeChanged) this.applyModeVisibility();
      this.recompute();
    }
  }

  // ---------------------------------------------------------------- markers

  private makeBeacon(which: 'a' | 'b', pos: LngLat): maplibregl.Marker {
    const el = document.createElement('div');
    el.className = `beacon beacon--${which}`;
    el.style.setProperty('--beacon', which === 'a' ? PALETTES[this.state.mode].accent : PALETTE_B.accent);
    el.innerHTML = '<div class="beacon-ring"></div><div class="beacon-ring beacon-ring--2"></div><div class="beacon-core"></div>';
    const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
      .setLngLat(pos)
      .addTo(this.map);
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      this.cb.onOriginDragged(which, [p.lng, p.lat]);
    });
    // don't drop a new origin when the click was actually a marker drag/click
    el.addEventListener('click', (e) => e.stopPropagation());
    return marker;
  }

  // ----------------------------------------------------------------- layers

  private addLayers(): void {
    const map = this.map;
    map.addSource('parks', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: this.city.parkRings.map((r) => polygonFeature(r)) },
    });
    map.addSource('water', { type: 'geojson', data: polygonFeature(this.city.riverRing) });
    map.addSource('streets', { type: 'geojson', data: this.streetFC });
    map.addSource('transit', { type: 'geojson', data: this.transitFC });
    map.addSource('stations', { type: 'geojson', data: this.stationFC });
    map.addSource('frontier', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({ id: 'parks', type: 'fill', source: 'parks', paint: { 'fill-color': COLORS.park, 'fill-opacity': 0.8 } });
    map.addLayer({ id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': COLORS.water } });

    map.addLayer({
      id: 'streets-dim',
      type: 'line',
      source: 'streets',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': ['case', ['>', ['get', 'w'], 1.2], COLORS.streetDimMajor, COLORS.streetDim] as never,
        'line-width': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          10,
          ['*', ['get', 'w'], 0.35],
          13,
          ['*', ['get', 'w'], 0.8],
          16,
          ['*', ['get', 'w'], 1.7],
        ] as never,
        'line-opacity': 0.85,
      },
    });
    const widthByZoom = (at10: number, at13: number, at16: number) =>
      [
        'interpolate',
        ['exponential', 1.6],
        ['zoom'],
        10,
        ['*', ['get', 'w'], at10],
        13,
        ['*', ['get', 'w'], at13],
        16,
        ['*', ['get', 'w'], at16],
      ] as never;
    map.addLayer({
      id: 'streets-lit',
      type: 'line',
      source: 'streets',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#000', 'line-width': widthByZoom(0.9, 2.1, 4.2), 'line-opacity': 0 },
    });

    map.addLayer({
      id: 'frontier',
      type: 'line',
      source: 'frontier',
      paint: {
        'line-color': ['match', ['get', 'which'], 'b', PALETTE_B.accent, PALETTES[this.state.mode].accent] as never,
        'line-width': 1.3,
        'line-opacity': 0.35,
        'line-dasharray': [3, 2.5],
      },
    });

    // classic transit-map look: white casing under solid line colours
    map.addLayer({
      id: 'transit-casing',
      type: 'line',
      source: 'transit',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': COLORS.casing,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 3.6, 13, 6, 16, 10] as never,
        'line-opacity': 0.9,
      },
    });
    map.addLayer({
      id: 'transit-dim',
      type: 'line',
      source: 'transit',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'] as never,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 1.8, 13, 3, 16, 5] as never,
        'line-opacity': 0.22,
      },
    });
    map.addLayer({
      id: 'transit-core',
      type: 'line',
      source: 'transit',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'] as never,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 1.8, 13, 3, 16, 5] as never,
        'line-opacity': 0,
      },
    });

    map.addLayer({
      id: 'stations-dim',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-color': COLORS.stationDim,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 13, 2.2, 16, 3.4] as never,
        'circle-opacity': 0.8,
      },
    });
    map.addLayer({
      id: 'stations-dot',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 0,
        'circle-opacity': 0,
        'circle-stroke-color': COLORS.stationStroke,
        'circle-stroke-width': 0,
        'circle-stroke-opacity': 0.9,
      },
    });
  }

  private applyModeVisibility(): void {
    const transit = this.state.mode === 'transit' ? 'visible' : 'none';
    for (const id of ['transit-casing', 'transit-dim', 'transit-core', 'stations-dim', 'stations-dot']) {
      this.map.setLayoutProperty(id, 'visibility', transit);
    }
    this.map.setPaintProperty('frontier', 'line-color', [
      'match',
      ['get', 'which'],
      'b',
      PALETTE_B.accent,
      PALETTES[this.state.mode].accent,
    ] as never);
  }

  // ------------------------------------------------------------- recompute

  private async recompute(): Promise<void> {
    const gen = ++this.generation;
    const { originA, originB, mode } = this.state;
    this.setLoading(true);

    try {
      // one batched fetch per origin — never refetched thanks to provider cache
      const [bandsA, bandsB] = await Promise.all([
        this.provider.fetchBands(originA, mode, BAND_MINUTES),
        originB ? this.provider.fetchBands(originB, mode, BAND_MINUTES) : Promise.resolve(null),
      ]);
      if (gen !== this.generation || this.destroyed) return;

      this.reachA = computeReach(this.city, this.tube, originA, mode);
      this.reachB = originB ? computeReach(this.city, this.tube, originB, mode) : null;
      this.profilesA = profilesFromRings(originA, bandsA);
      this.profilesB = originB && bandsB ? profilesFromRings(originB, bandsB) : null;

      const a = this.reachA;
      const b = this.reachB;
      for (let i = 0; i < this.streetFC.features.length; i++) {
        const p = this.streetFC.features[i].properties;
        p.ta = a.edgeT[i];
        p.da = a.edgeDur[i];
        p.tb = b ? b.edgeT[i] : UNREACHED;
        p.db = b ? b.edgeDur[i] : 1;
      }
      (this.map.getSource('streets') as maplibregl.GeoJSONSource).setData(this.streetFC);

      const stationT = (si: number) =>
        Math.min(a.stationMin[si], b ? b.stationMin[si] : UNREACHED);
      updateTransitTimes(this.tube, this.transitFC, stationT);
      (this.map.getSource('transit') as maplibregl.GeoJSONSource).setData(this.transitFC);
      this.stationFC.features.forEach((f, si) => {
        f.properties.t = stationT(si);
      });
      (this.map.getSource('stations') as maplibregl.GeoJSONSource).setData(this.stationFC);

      // per-minute cumulative counts -> O(1) live stats at any fractional T
      const E = this.city.edges.length;
      const minEdge = new Float32Array(E);
      const maxEdge = new Float32Array(E);
      for (let i = 0; i < E; i++) {
        minEdge[i] = Math.min(a.edgeT[i], b ? b.edgeT[i] : UNREACHED);
        maxEdge[i] = b ? Math.max(a.edgeT[i], b.edgeT[i]) : UNREACHED;
      }
      this.cumStreets = histogram(minEdge);
      this.cumShared = b ? histogram(maxEdge) : null;
      const N = this.city.nodes.length;
      const minNode = new Float32Array(N);
      for (let i = 0; i < N; i++) minNode[i] = Math.min(a.nodeMin[i], b ? b.nodeMin[i] : UNREACHED);
      this.cumNodes = histogram(minNode);
      const S = this.tube.stations.length;
      const minStation = new Float32Array(S);
      for (let i = 0; i < S; i++) minStation[i] = stationT(i);
      this.cumStations = histogram(minStation);

      // bloom the reveal from zero
      this.smoothT = 0;
      this.revealStartMs = performance.now();
      this.lastPaintT = -1;
    } finally {
      if (gen === this.generation) this.setLoading(false);
    }
  }

  private setLoading(loading: boolean): void {
    this.loading = loading;
    this.markerA.getElement().classList.toggle('is-loading', loading);
    this.markerB?.getElement().classList.toggle('is-loading', loading);
  }

  // ----------------------------------------------------------------- frame

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;
    this.frameCount++;
    if (!this.ready || this.loading || !this.reachA) {
      this.pushStats(0);
      return;
    }

    const target = this.state.minutes;
    this.smoothT += (target - this.smoothT) * (1 - Math.exp(-dt / SMOOTH_TAU));
    if (Math.abs(target - this.smoothT) < 0.004) this.smoothT = target;

    // reveal sweep after fresh data: cap T so the colour sweeps outward
    const revealCap = ((now - this.revealStartMs) / 1000) * REVEAL_MINUTES_PER_SEC;
    const T = Math.max(0.05, Math.min(this.smoothT, revealCap));

    const tMoving = Math.abs(T - this.lastPaintT) > 0.002;
    if (tMoving) {
      this.paint(T);
      this.lastPaintT = T;
      if (this.frameCount % 2 === 0) this.updateFrontier(T);
    }
    this.pushStats(T);
  }

  private paint(T: number): void {
    const map = this.map;
    const comparing = !!this.reachB;
    const palA = PALETTES[this.state.mode];
    const z = map.getZoom();
    const sp = streetPaint(T, palA, PALETTE_B, comparing);
    const opts = { validate: false };
    map.setPaintProperty('streets-lit', 'line-color', sp.color as never, opts);
    map.setPaintProperty('streets-lit', 'line-opacity', sp.opacity as never, opts);

    if (this.state.mode === 'transit') {
      map.setPaintProperty('transit-core', 'line-opacity', transitProgress(T) as never, opts);
      const st = stationPaint(T, zoomLerp(z, 0.7, 1.1, 1.7));
      map.setPaintProperty('stations-dot', 'circle-radius', st.radius as never, opts);
      map.setPaintProperty('stations-dot', 'circle-opacity', st.opacity as never, opts);
      map.setPaintProperty('stations-dot', 'circle-stroke-width', st.strokeWidth as never, opts);
    }
  }

  private updateFrontier(T: number): void {
    const features: GeoJSON.Feature[] = [];
    if (this.profilesA) {
      const ring = ringFromProfile(this.state.originA, profileAt(BAND_MINUTES, this.profilesA, T));
      features.push({
        type: 'Feature',
        properties: { which: 'a' },
        geometry: { type: 'LineString', coordinates: [...ring, ring[0]].slice(0, N_SPOKES + 1) },
      });
    }
    if (this.profilesB && this.state.originB) {
      const ring = ringFromProfile(this.state.originB, profileAt(BAND_MINUTES, this.profilesB, T));
      features.push({
        type: 'Feature',
        properties: { which: 'b' },
        geometry: { type: 'LineString', coordinates: [...ring, ring[0]].slice(0, N_SPOKES + 1) },
      });
    }
    (this.map.getSource('frontier') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }

  private pushStats(T: number): void {
    const comparing = !!this.reachB;
    const stats: LiveStats = {
      minutes: this.state.minutes,
      streetsLit: Math.round(atMinute(this.cumStreets, T)),
      stationsReached: this.state.mode === 'transit' ? Math.round(atMinute(this.cumStations, T)) : 0,
      areaKm2: atMinute(this.cumNodes, T) * this.city.cellAreaKm2,
      overlapStreets: comparing ? Math.round(atMinute(this.cumShared, T)) : 0,
      comparing,
      loading: this.loading,
    };
    const key = `${stats.minutes}|${stats.streetsLit}|${stats.stationsReached}|${stats.areaKm2.toFixed(1)}|${stats.overlapStreets}|${stats.loading}`;
    if (key !== this.lastStatsKey) {
      this.lastStatsKey = key;
      this.cb.onStats(stats);
    }
  }
}
