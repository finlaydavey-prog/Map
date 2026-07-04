import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { GlowEngine, type EngineCallbacks, type LiveStats } from '../map/engine';
import type { JourneyOptions, LngLat } from '../lib/types';

export interface MapViewHandle {
  flyTo(pos: LngLat): void;
  isInsideDemoArea(pos: LngLat): boolean;
}

interface Props {
  originA: LngLat;
  originB: LngLat | null;
  minutes: number;
  options: JourneyOptions;
  onStats(stats: LiveStats): void;
  onMapClick(pos: LngLat): void;
  onOriginDragged(which: 'a' | 'b', pos: LngLat): void;
  onToast(message: string): void;
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<GlowEngine | null>(null);
  const cbs = useRef<EngineCallbacks>({
    onStats: props.onStats,
    onMapClick: props.onMapClick,
    onOriginDragged: props.onOriginDragged,
    onToast: props.onToast,
  });
  cbs.current.onStats = props.onStats;
  cbs.current.onMapClick = props.onMapClick;
  cbs.current.onOriginDragged = props.onOriginDragged;
  cbs.current.onToast = props.onToast;

  const latest = useRef({ originA: props.originA, originB: props.originB, minutes: props.minutes, options: props.options });
  latest.current = { originA: props.originA, originB: props.originB, minutes: props.minutes, options: props.options };

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let created: GlowEngine | null = null;
    GlowEngine.create(container.current, latest.current, {
      onStats: (s) => cbs.current.onStats(s),
      onMapClick: (p) => cbs.current.onMapClick(p),
      onOriginDragged: (w, p) => cbs.current.onOriginDragged(w, p),
      onToast: (m) => cbs.current.onToast(m),
    }).then((e) => {
      if (cancelled) {
        e.destroy();
        return;
      }
      created = e;
      engine.current = e;
      // catch up on any prop changes that landed while the engine was loading
      e.update(latest.current);
    });
    return () => {
      cancelled = true;
      engine.current = null;
      created?.destroy();
    };
    // engine is created once; later prop changes flow through engine.update below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.current?.update({
      originA: props.originA,
      originB: props.originB,
      minutes: props.minutes,
      options: props.options,
    });
  }, [props.originA, props.originB, props.minutes, props.options]);

  useImperativeHandle(ref, () => ({
    flyTo: (pos) => engine.current?.flyTo(pos),
    isInsideDemoArea: (pos) => engine.current?.isInsideDemoArea(pos) ?? false,
  }));

  return <div ref={container} className="absolute inset-0" />;
});
