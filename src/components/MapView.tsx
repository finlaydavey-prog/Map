import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GlowEngine, type EngineCallbacks, type LiveStats } from '../map/engine';
import type { LngLat, TravelMode } from '../lib/types';

export interface MapViewHandle {
  flyTo(pos: LngLat): void;
  isInsideDemoArea(pos: LngLat): boolean;
}

interface Props {
  originA: LngLat;
  originB: LngLat | null;
  mode: TravelMode;
  minutes: number;
  onStats(stats: LiveStats): void;
  onMapClick(pos: LngLat): void;
  onOriginDragged(which: 'a' | 'b', pos: LngLat): void;
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<GlowEngine | null>(null);
  const cbs = useRef<EngineCallbacks>({
    onStats: props.onStats,
    onMapClick: props.onMapClick,
    onOriginDragged: props.onOriginDragged,
  });
  cbs.current.onStats = props.onStats;
  cbs.current.onMapClick = props.onMapClick;
  cbs.current.onOriginDragged = props.onOriginDragged;

  useEffect(() => {
    if (!container.current) return;
    const e = new GlowEngine(
      container.current,
      { originA: props.originA, originB: props.originB, mode: props.mode, minutes: props.minutes },
      {
        onStats: (s) => cbs.current.onStats(s),
        onMapClick: (p) => cbs.current.onMapClick(p),
        onOriginDragged: (w, p) => cbs.current.onOriginDragged(w, p),
      },
    );
    engine.current = e;
    return () => {
      engine.current = null;
      e.destroy();
    };
    // engine is created once; later prop changes flow through engine.update below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.current?.update({
      originA: props.originA,
      originB: props.originB,
      mode: props.mode,
      minutes: props.minutes,
    });
  }, [props.originA, props.originB, props.mode, props.minutes]);

  useImperativeHandle(ref, () => ({
    flyTo: (pos) => engine.current?.flyTo(pos),
    isInsideDemoArea: (pos) => engine.current?.isInsideDemoArea(pos) ?? false,
  }));

  return (
    <div className="absolute inset-0">
      <div ref={container} className="absolute inset-0" />
      {/* soft vignette so the map reads like a city seen at night from above */}
      <div className="vignette pointer-events-none absolute inset-0" />
    </div>
  );
});
