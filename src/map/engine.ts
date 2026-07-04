import type maplibregl from 'maplibre-gl';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { profileAt, profilesFromRings, ringFromProfile, type Profile } from '../lib/bands';
import { LIVE, LIVE_BOUNDS, MAPBOX_TOKEN } from '../lib/config';
import { KM_PER_DEG_LAT, KM_PER_DEG_LNG } from '../lib/geo';
import { assignStreetTimes, harvestStreets } from '../lib/live/harvest';
import { transitField, type TimeField } from '../lib/live/timeField';
import { computeTransitStationTimes } from '../lib/live/transitLite';
import { buildCity, distToNetworkKm } from '../lib/mock/city';
import { loadTubeNetwork } from '../lib/tube/load';
import { BAND_MINUTES, MockIsochroneProvider } from '../lib/providers/isochrone';
import { computeReach, UNREACHED, type ReachResult } from '../lib/reach';
import type { JourneyOptions, LngLat, TubeNetwork } from '../lib/types';
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
import { ACCENT, COLORS, COMPARE_A_ACCENT, COMPARE_B_ACCENT, LIKELIHOOD_STOPS } from './palette';

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
  onToast(message: string): void;
}

interface EngineState {
  originA: LngLat;
  originB: LngLat | null;
  minutes: number;
  options: JourneyOptions;
}

const REVEAL_MINUTES_PER_SEC = 26; // sweep speed after data arrives
const SMOOTH_TAU = 0.13; // slider-tracking time constant, seconds

function histogram(times: ArrayLike<number>): Float32Array {
  const cum = new Float32Array(62);
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t >= UNREACHED) continue;
    const bin = Math.min(61, Math.max(0, Math.ceil(t)));
    cum[bin]++;
  }
  for (let i = 1; i < 62; i++) cum[i] += cum[i - 1];
  return cum;
}

function atMinute(cum: Float32Array | null, t: number): number {
  if (!cum) return 0;
  const lo = Math.min(61, Math.max(0, Math.floor(t)));
  const hi = Math.min(61, lo + 1);
  return cum[lo] + (cum[hi] - cum[lo]) * (t - lo);
}

/** exponential zoom interpolation (base 1.6) across stops 10 -> 13 -> 16 */
function zoomLerp(z: number, at10: number, at13: number, at16: number): number {
  const seg = (z0: number, z1: number, v0: number, v1: number) => {
    const t = (Math.pow(1.6, z - z0) - 1) / (Math.pow(1.6, z1 - z0) - 1);
    return v0 + (v1 - v0) * Math.max(0, Math.min(1, t));
  };
  return z <= 13 ? seg(10, 13, at10, at13) : seg(13, 16, at13, at16);
}

/** union reachable area for compare mode: grid-sample min(tA, tB) */
function gridUnionArea(fields: TimeField[], bbox: [number, number, number, number]): Float32Array {
  const [lngMin, latMin, lngMax, latMax] = bbox;
  const NX = 88;
  const NY = 64;
  const cellKm2 = (((lngMax - lngMin) / NX) * KM_PER_DEG_LNG) * (((latMax - latMin) / NY) * KM_PER_DEG_LAT);
  const area = new Float32Array(61);
  for (let iy = 0; iy < NY; iy++) {
    for (let ix = 0; ix < NX; ix++) {
      const p: LngLat = [
        lngMin + ((ix + 0.5) / NX) * (lngMax - lngMin),
        latMin + ((iy + 0.5) / NY) * (latMax - latMin),
      ];
      let t = UNREACHED;
      for (const f of fields) t = Math.min(t, f.timeAt(p));
      const bin = Math.ceil(t);
      if (bin <= 60) area[Math.max(0, bin)] += cellKm2;
    }
  }
  for (let m = 1; m <= 60; m++) area[m] += area[m - 1];
  return area;
}

type GlModule = typeof maplibregl;

export class GlowEngine {
  readonly map: maplibregl.Map;
  private gl: GlModule;
  private live = LIVE;

  private tube: TubeNetwork;
  // mock-mode data (only built when running keyless)
  private city = this.live ? null : buildCity();
  private provider: MockIsochroneProvider | null = null;

  private streetFC: FeatureCollection<LineString, StreetProps>;
  private transitFC: FeatureCollection<LineString, TransitSegProps>;
  private stationFC: FeatureCollection<Point, StationProps>;

  private state: EngineState;
  // mock reach results
  private reachA: ReachResult | null = null;
  private reachB: ReachResult | null = null;
  // live time fields
  private fieldA: TimeField | null = null;
  private fieldB: TimeField | null = null;
  // mock frontier profiles
  private profilesA: Profile[] | null = null;
  private profilesB: Profile[] | null = null;
  private hasData = false;

  private cumStreets: Float32Array | null = null;
  private cumShared: Float32Array | null = null;
  private cumStations: Float32Array | null = null;
  private cumArea: Float32Array | null = null;
  private areaScale = 1; // mock: cellArea multiplier; live: 1 (areas already km²)

  private markerA: maplibregl.Marker;
  private markerB: maplibregl.Marker | null = null;

  private smoothT = 0;
  private revealStartMs = 0;
  private firstHarvestDone = false;
  private lastFrameMs = 0;
  private lastPaintT = -1;
  private generation = 0;
  private loading = false;
  private ready = false;
  private raf = 0;
  private frameCount = 0;
  private lastStatsKey = '';
  private destroyed = false;
  private harvestTimer: ReturnType<typeof setTimeout> | null = null;

  /** Async factory: dynamically loads mapbox-gl (token present) or maplibre-gl (mock). */
  static async create(container: HTMLElement, initial: EngineState, cb: EngineCallbacks): Promise<GlowEngine> {
    const [gl, tube] = await Promise.all([
      (async (): Promise<GlModule> => {
        if (LIVE) {
          const mod = (await import('mapbox-gl')).default;
          (mod as { accessToken: string }).accessToken = MAPBOX_TOKEN!;
          return mod as unknown as GlModule;
        }
        return (await import('maplibre-gl')).default as GlModule;
      })(),
      loadTubeNetwork(),
    ]);
    return new GlowEngine(gl, tube, container, initial, cb);
  }

  private constructor(
    gl: GlModule,
    tube: TubeNetwork,
    container: HTMLElement,
    initial: EngineState,
    private cb: EngineCallbacks,
  ) {
    this.gl = gl;
    this.tube = tube;
    this.state = { ...initial };
    if (!this.live) this.provider = new MockIsochroneProvider(this.city!, this.tube);
    this.streetFC = this.live
      ? { type: 'FeatureCollection', features: [] }
      : buildStreetCollection(this.city!);
    this.transitFC = buildTransitCollection(this.tube);
    this.stationFC = buildStationCollection(this.tube);

    const bounds: [number, number, number, number] = this.live ? LIVE_BOUNDS : this.city!.bbox;
    const pad = this.live ? 0 : 0.09;

    this.map = new this.gl.Map({
      container,
      style: this.live
        ? ('mapbox://styles/mapbox/light-v11' as never)
        : {
            version: 8,
            sources: {},
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': COLORS.bg } }],
          },
      center: initial.originA,
      zoom: 12.1,
      minZoom: 10.4,
      maxZoom: 16.5,
      maxBounds: [
        [bounds[0] - pad, bounds[1] - pad / 2],
        [bounds[2] + pad, bounds[3] + pad / 2],
      ],
      attributionControl: this.live as never,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    } as never);
    this.map.touchZoomRotate.disableRotation();
    this.map.getCanvas().style.cursor = 'crosshair';

    this.markerA = this.makeBeacon('a', initial.originA);

    this.map.on('click', (e) => this.cb.onMapClick([e.lngLat.lng, e.lngLat.lat]));
    // widths are zoom-dependent but computed in JS, so force a repaint on zoom
    this.map.on('zoom', () => {
      this.lastPaintT = -1;
    });
    if (this.live) {
      // new tiles -> new streets to light; debounce keeps panning smooth
      this.map.on('idle', () => this.scheduleHarvest());
    }
    this.map.on('load', () => {
      this.addLayers();
      this.ready = true;
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
    if (this.harvestTimer) clearTimeout(this.harvestTimer);
    this.map.remove();
  }

  isInsideDemoArea(pos: LngLat): boolean {
    if (this.live) {
      return (
        pos[0] > LIVE_BOUNDS[0] && pos[0] < LIVE_BOUNDS[2] && pos[1] > LIVE_BOUNDS[1] && pos[1] < LIVE_BOUNDS[3]
      );
    }
    return distToNetworkKm(this.city!, pos) < 0.9;
  }

  flyTo(pos: LngLat): void {
    this.map.flyTo({ center: pos, zoom: Math.max(this.map.getZoom(), 12.2), speed: 1.4 });
  }

  /** React pushes desired state here; the engine diffs and reacts. */
  update(next: EngineState): void {
    const prev = this.state;
    this.state = { ...next, options: { ...next.options, methods: { ...next.options.methods } } };
    const originChanged =
      prev.originA[0] !== next.originA[0] ||
      prev.originA[1] !== next.originA[1] ||
      (prev.originB === null) !== (next.originB === null) ||
      (prev.originB && next.originB && (prev.originB[0] !== next.originB[0] || prev.originB[1] !== next.originB[1]));
    const optionsChanged = JSON.stringify(prev.options) !== JSON.stringify(next.options);

    if (next.originB && !this.markerB) this.markerB = this.makeBeacon('b', next.originB);
    if (!next.originB && this.markerB) {
      this.markerB.remove();
      this.markerB = null;
    }
    if (next.originB && this.markerB) this.markerB.setLngLat(next.originB);
    this.markerA.setLngLat(next.originA);

    if (this.ready && (originChanged || optionsChanged)) this.recompute();
  }

  // ---------------------------------------------------------------- markers

  private makeBeacon(which: 'a' | 'b', pos: LngLat): maplibregl.Marker {
    const el = document.createElement('div');
    el.className = `beacon beacon--${which}`;
    el.style.setProperty('--beacon', which === 'a' ? ACCENT : COMPARE_B_ACCENT);
    el.innerHTML = '<div class="beacon-ring"></div><div class="beacon-ring beacon-ring--2"></div><div class="beacon-core"></div>';
    const marker = new this.gl.Marker({ element: el, draggable: true, anchor: 'center' })
      .setLngLat(pos)
      .addTo(this.map);
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      this.cb.onOriginDragged(which, [p.lng, p.lat]);
    });
    el.addEventListener('click', (e) => e.stopPropagation());
    return marker;
  }

  // ----------------------------------------------------------------- layers

  private addLayers(): void {
    const map = this.map;

    // in live mode, draw our overlays underneath the basemap's labels
    const beforeId = this.live
      ? map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
      : undefined;
    const add = (layer: never) => (beforeId ? map.addLayer(layer, beforeId) : map.addLayer(layer));

    if (!this.live) {
      const city = this.city!;
      map.addSource('parks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: city.parkRings.map((r) => polygonFeature(r)) },
      });
      map.addSource('water', { type: 'geojson', data: polygonFeature(city.riverRing) });
      add({ id: 'parks', type: 'fill', source: 'parks', paint: { 'fill-color': COLORS.park, 'fill-opacity': 0.8 } } as never);
      add({ id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': COLORS.water } } as never);
    }

    map.addSource('streets', { type: 'geojson', data: this.streetFC });
    map.addSource('transit', { type: 'geojson', data: this.transitFC });
    map.addSource('stations', { type: 'geojson', data: this.stationFC });
    map.addSource('frontier', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    if (!this.live) {
      add({
        id: 'streets-dim',
        type: 'line',
        source: 'streets',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['case', ['>', ['get', 'w'], 1.2], COLORS.streetDimMajor, COLORS.streetDim],
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
          ],
          'line-opacity': 0.85,
        },
      } as never);
    }

    add({
      id: 'streets-lit',
      type: 'line',
      source: 'streets',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#000',
        'line-width': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          10,
          ['*', ['get', 'w'], 0.8],
          13,
          ['*', ['get', 'w'], 1.9],
          16,
          ['*', ['get', 'w'], 3.8],
        ],
        'line-opacity': 0,
      },
    } as never);

    add({
      id: 'frontier',
      type: 'line',
      source: 'frontier',
      paint: {
        'line-color': ['match', ['get', 'which'], 'b', COMPARE_B_ACCENT, LIKELIHOOD_STOPS[3]],
        'line-width': 1.3,
        'line-opacity': 0.35,
        'line-dasharray': [3, 2.5],
      },
    } as never);

    // transit sits ABOVE the street colouring and clearly wider (Google-maps
    // style: the network reads as the primary structure)
    add({
      id: 'transit-casing',
      type: 'line',
      source: 'transit',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': COLORS.casing,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 5, 13, 8.5, 16, 14],
        'line-opacity': 0.92,
      },
    } as never);
    add({
      id: 'transit-dim',
      type: 'line',
      source: 'transit',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 2.8, 13, 4.8, 16, 8],
        'line-opacity': 0.22,
      },
    } as never);
    add({
      id: 'transit-core',
      type: 'line',
      source: 'transit',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 2.8, 13, 4.8, 16, 8],
        'line-opacity': 0,
      },
    } as never);

    add({
      id: 'stations-dim',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-color': COLORS.stationDim,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.7, 13, 2.7, 16, 4.2],
        'circle-opacity': 0.8,
      },
    } as never);
    add({
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
    } as never);
  }

  /** disabled networks keep only their pale dim rendering */
  private applyMethodFilter(): void {
    const enabled = Object.entries(this.state.options.methods)
      .filter(([, on]) => on)
      .map(([m]) => m);
    const filter = ['in', ['get', 'mode'], ['literal', enabled]] as never;
    this.map.setFilter('transit-core', filter);
    this.map.setFilter('transit-casing', filter);
  }

  // -------------------------------------------------------------- harvesting

  private scheduleHarvest(): void {
    if (this.harvestTimer) clearTimeout(this.harvestTimer);
    this.harvestTimer = setTimeout(() => this.harvestNow(), 250);
  }

  private harvestNow(): void {
    if (!this.live || !this.ready || this.destroyed) return;
    const b = this.map.getBounds();
    const fc = harvestStreets(this.map as never, 'transit', [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ]);
    if (fc.features.length === 0) return;
    this.streetFC = fc;
    if (this.fieldA) {
      assignStreetTimes(this.streetFC, 'transit', this.fieldA, this.fieldB);
      this.rebuildStreetHistograms();
      if (!this.firstHarvestDone) {
        this.firstHarvestDone = true;
        this.revealStartMs = performance.now(); // bloom once real streets exist
      }
    }
    (this.map.getSource('streets') as maplibregl.GeoJSONSource).setData(this.streetFC);
    this.lastPaintT = -1;
  }

  private rebuildStreetHistograms(): void {
    const F = this.streetFC.features;
    const minT = new Float32Array(F.length);
    const maxT = new Float32Array(F.length);
    const comparing = !!(this.live ? this.fieldB : this.reachB);
    for (let i = 0; i < F.length; i++) {
      const p = F[i].properties;
      minT[i] = Math.min(p.ta as number, p.tb as number);
      maxT[i] = comparing ? Math.max(p.ta as number, p.tb as number) : UNREACHED;
    }
    this.cumStreets = histogram(minT);
    this.cumShared = comparing ? histogram(maxT) : null;
  }

  // ------------------------------------------------------------- recompute

  private async recompute(): Promise<void> {
    const gen = ++this.generation;
    this.setLoading(true);

    try {
      if (this.live) {
        this.recomputeLive();
      } else {
        await this.recomputeMock(gen);
      }
      if (gen !== this.generation || this.destroyed) return;
      this.applyMethodFilter();
      // frontier colours depend on whether we're comparing
      this.map.setPaintProperty('frontier', 'line-color', [
        'match',
        ['get', 'which'],
        'b',
        COMPARE_B_ACCENT,
        this.state.originB ? COMPARE_A_ACCENT : LIKELIHOOD_STOPS[3],
      ] as never);
      this.hasData = true;
      this.smoothT = 0;
      this.revealStartMs = performance.now();
      this.lastPaintT = -1;
    } catch (err) {
      if (gen === this.generation && !this.destroyed) {
        const msg = err instanceof Error ? err.message : String(err);
        this.cb.onToast(`Could not compute travel times: ${msg}`);
      }
    } finally {
      if (gen === this.generation) this.setLoading(false);
    }
  }

  private recomputeLive(): void {
    const { originA, originB, options } = this.state;
    const caps = { maxWalkMin: options.maxWalkMin, maxCycleMin: options.maxCycleMin };

    const sA = computeTransitStationTimes(this.tube, originA, options);
    const sB = originB ? computeTransitStationTimes(this.tube, originB, options) : null;
    this.fieldA = transitField(originA, this.tube, sA, LIVE_BOUNDS, caps);
    this.fieldB = originB && sB ? transitField(originB, this.tube, sB, LIVE_BOUNDS, caps) : null;

    const stationT = (si: number) => Math.min(sA[si], sB ? sB[si] : UNREACHED);
    const minStation = new Float32Array(this.tube.stations.length);
    for (let i = 0; i < minStation.length; i++) minStation[i] = stationT(i);
    this.cumStations = histogram(minStation);

    updateTransitTimes(this.tube, this.transitFC, stationT);
    (this.map.getSource('transit') as maplibregl.GeoJSONSource).setData(this.transitFC);
    this.stationFC.features.forEach((f, si) => {
      f.properties.t = stationT(si);
    });
    (this.map.getSource('stations') as maplibregl.GeoJSONSource).setData(this.stationFC);

    this.areaScale = 1;
    this.cumArea = this.fieldB
      ? gridUnionArea([this.fieldA, this.fieldB], LIVE_BOUNDS)
      : this.fieldA.areaByMinute();

    // stamp times onto whatever streets are currently harvested
    if (this.streetFC.features.length > 0) {
      assignStreetTimes(this.streetFC, 'transit', this.fieldA, this.fieldB);
      this.rebuildStreetHistograms();
      (this.map.getSource('streets') as maplibregl.GeoJSONSource).setData(this.streetFC);
    } else {
      this.scheduleHarvest();
    }
  }

  private async recomputeMock(gen: number): Promise<void> {
    const { originA, originB, options } = this.state;
    const city = this.city!;
    const enabled = (m: string) => options.methods[m as keyof typeof options.methods] ?? true;
    const [bandsA, bandsB] = await Promise.all([
      this.provider!.fetchBands(originA, 'transit', BAND_MINUTES),
      originB ? this.provider!.fetchBands(originB, 'transit', BAND_MINUTES) : Promise.resolve(null),
    ]);
    if (gen !== this.generation || this.destroyed) return;

    this.reachA = computeReach(city, this.tube, originA, 'transit', enabled);
    this.reachB = originB ? computeReach(city, this.tube, originB, 'transit', enabled) : null;
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
    this.rebuildStreetHistograms();

    const stationT = (si: number) => Math.min(a.stationMin[si], b ? b.stationMin[si] : UNREACHED);
    updateTransitTimes(this.tube, this.transitFC, stationT);
    (this.map.getSource('transit') as maplibregl.GeoJSONSource).setData(this.transitFC);
    this.stationFC.features.forEach((f, si) => {
      f.properties.t = stationT(si);
    });
    (this.map.getSource('stations') as maplibregl.GeoJSONSource).setData(this.stationFC);

    const N = city.nodes.length;
    const minNode = new Float32Array(N);
    for (let i = 0; i < N; i++) minNode[i] = Math.min(a.nodeMin[i], b ? b.nodeMin[i] : UNREACHED);
    this.cumArea = histogram(minNode);
    this.areaScale = city.cellAreaKm2;
    const S = this.tube.stations.length;
    const minStation = new Float32Array(S);
    for (let i = 0; i < S; i++) minStation[i] = stationT(i);
    this.cumStations = histogram(minStation);
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
    if (!this.ready || this.loading || !this.hasData) {
      this.pushStats(0);
      return;
    }

    const target = this.state.minutes;
    this.smoothT += (target - this.smoothT) * (1 - Math.exp(-dt / SMOOTH_TAU));
    if (Math.abs(target - this.smoothT) < 0.004) this.smoothT = target;

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
    const comparing = this.live ? !!this.fieldB : !!this.reachB;
    const z = map.getZoom();
    const sp = streetPaint(T, comparing);
    const opts = { validate: false };
    map.setPaintProperty('streets-lit', 'line-color', sp.color as never, opts);
    map.setPaintProperty('streets-lit', 'line-opacity', sp.opacity as never, opts);

    map.setPaintProperty('transit-core', 'line-opacity', transitProgress(T) as never, opts);
    const st = stationPaint(T, zoomLerp(z, 0.85, 1.35, 2.1));
    map.setPaintProperty('stations-dot', 'circle-radius', st.radius as never, opts);
    map.setPaintProperty('stations-dot', 'circle-opacity', st.opacity as never, opts);
    map.setPaintProperty('stations-dot', 'circle-stroke-width', st.strokeWidth as never, opts);
  }

  private updateFrontier(T: number): void {
    const features: GeoJSON.Feature[] = [];
    const push = (which: 'a' | 'b', ring: LngLat[] | null) => {
      if (!ring) return;
      features.push({
        type: 'Feature',
        properties: { which },
        geometry: { type: 'LineString', coordinates: [...ring, ring[0]] },
      });
    };
    if (this.live) {
      push('a', this.fieldA?.frontierRing(T) ?? null);
      push('b', this.fieldB?.frontierRing(T) ?? null);
    } else {
      if (this.profilesA) push('a', ringFromProfile(this.state.originA, profileAt(BAND_MINUTES, this.profilesA, T)));
      if (this.profilesB && this.state.originB)
        push('b', ringFromProfile(this.state.originB, profileAt(BAND_MINUTES, this.profilesB, T)));
    }
    (this.map.getSource('frontier') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }

  private pushStats(T: number): void {
    const comparing = this.live ? !!this.fieldB : !!this.reachB;
    const stats: LiveStats = {
      minutes: this.state.minutes,
      streetsLit: Math.round(atMinute(this.cumStreets, T)),
      stationsReached: Math.round(atMinute(this.cumStations, T)),
      areaKm2: atMinute(this.cumArea, T) * this.areaScale,
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
