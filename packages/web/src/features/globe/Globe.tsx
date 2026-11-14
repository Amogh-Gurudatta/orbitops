// The 3D globe (deck.gl GlobeView). Used live on the Fleet and Ground Stations pages and, with `mode="replay"`,
// by the Replay page. Satellite positions are propagated client-side from catalogue TLEs at the displayed time
// (server-corrected "now" when live, `timeMs` in replay), so the globe never waits on telemetry.
//
// Rendering is imperative: one DeckGL instance is mounted once and a 10 Hz callback on the shared frame loop
// builds the layer list from refs and pushes it with `deck.setProps`. React re-renders only on prop changes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Deck, LinearInterpolator, _GlobeView as GlobeView, type PickingInfo } from '@deck.gl/core';
import type { Layer } from '@deck.gl/core';
import { fetchStations, queryKeys } from '../../api/endpoints.ts';
import type { GroundStation } from '../../api/types.ts';
import { cx } from '../../lib/cx.ts';
import { serverNow } from '../../realtime/clock.ts';
import { onFrame } from '../../realtime/frameLoop.ts';
import { useAlertsStore } from '../../realtime/alertsStore.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { telemetryStore } from '../../realtime/telemetryStore.ts';
import { ErrorState } from '../../ui/index.ts';
import { visualAltitudeM } from './altitude.ts';
import type { LonLat } from './antimeridian.ts';
import { coverageCells } from './footprint.ts';
import { GlobeLegend, GlobeToggles, type LayerToggles } from './GlobeControls.tsx';
import {
  baseLayers,
  coverageLayer,
  nightLayer,
  satelliteLayers,
  stationLayers,
  trackLayers,
  type SatPoint,
  type TrackSet,
} from './layers.ts';
import { FleetPropagator, groundTrack, type SatPosition } from './orbit.ts';
import { STATUS_COLOR, type Rgba } from './palette.ts';
import { nightPolygon } from './solar.ts';

export interface GlobeProps {
  mode: 'live' | 'replay';
  /** Replay: the time to render (positions are propagated client-side from TLEs at this time). */
  timeMs?: number;
  selectedSatId?: number | null;
  onSelectSat?: (satId: number) => void;
  /** Called when the same satellite is clicked twice in quick succession (open its detail page). */
  onOpenSat?: (satId: number) => void;
  /** Magenta predicted track (next ~90 min) and grey past track for the selected satellite. Default true. */
  showGroundTracks?: boolean;
  /** Ground station markers. Default true. */
  showStations?: boolean;
  /** H3 coverage hexes of the stations' visibility footprint. Default false. */
  showCoverage?: boolean;
  /** Only show satellites in these groups. */
  filterGroups?: string[] | null;
  /** Ground station to emphasise (stations page). */
  highlightStationId?: string;
  /** Click on a ground-station marker. */
  onSelectStation?: (stationId: string) => void;
  className?: string;
}

const RENDER_HZ = 10;
const TRACK_PAST_MS = 45 * 60_000;
const TRACK_FUTURE_MS = 90 * 60_000;
const TRACK_STEP_MS = 30_000;
const TRACK_REFRESH_MS = 15_000;
const DOUBLE_CLICK_MS = 400;
/** Selecting a satellite further than this (degrees) from the view centre rotates the globe to it. */
const FOCUS_THRESHOLD_DEG = 60;

type DeckInstance = Deck<GlobeView>;

const VIEW = new GlobeView({ id: 'globe', resolution: 4 });
const INITIAL_VIEW_STATE = { longitude: 20, latitude: 4, zoom: 0.2, minZoom: -0.5, maxZoom: 6 };
/** Measured: the globe disc has this radius in CSS pixels at zoom 0 (it doubles per zoom level). */
const GLOBE_RADIUS_PX_AT_ZOOM_0 = 70;
const CONTROLLER = { doubleClickZoom: false, keyboard: false, inertia: false };

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Great-circle separation in degrees between two lon/lat points. */
function separationDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const c =
    Math.sin(lat1 * rad) * Math.sin(lat2 * rad) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon1 - lon2) * rad);
  return Math.acos(Math.min(1, Math.max(-1, c))) / rad;
}

interface DeckHandlers {
  getTooltip(info: PickingInfo): { html: string; style: Partial<CSSStyleDeclaration> } | null;
  onClick(info: PickingInfo): void;
  onViewStateChange(params: { viewState: object }): void;
  onError(error: Error): void;
}

const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  backgroundColor: '#242522',
  color: '#d8d6ce',
  border: '1px solid #3a3b37',
  borderRadius: '0',
  boxShadow: 'none',
  padding: '4px 8px',
  fontFamily: '"B612 Mono", ui-monospace, monospace',
  fontSize: '11px',
  lineHeight: '16px',
};

export function Globe(props: GlobeProps) {
  const { showGroundTracks = true, showStations = true, showCoverage = false, className } = props;

  const [toggles, setToggles] = useState<LayerToggles>({
    trk: showGroundTracks,
    gs: showStations,
    cov: showCoverage,
    night: true,
  });
  // The overlay toggles start from the props and follow later prop changes.
  useEffect(() => setToggles((t) => ({ ...t, trk: showGroundTracks })), [showGroundTracks]);
  useEffect(() => setToggles((t) => ({ ...t, gs: showStations })), [showStations]);
  useEffect(() => setToggles((t) => ({ ...t, cov: showCoverage })), [showCoverage]);

  const needsStations = toggles.gs || toggles.cov;
  const stationsQuery = useQuery({
    queryKey: queryKeys.stations,
    queryFn: fetchStations,
    staleTime: 10 * 60_000,
    enabled: needsStations,
  });
  const stations = stationsQuery.data;
  const coverage = useMemo(
    () => (toggles.cov && stations ? coverageCells(stations) : []),
    [toggles.cov, stations],
  );

  const catalogSize = useFleetStore((s) => Object.keys(s.catalog).length);
  const [failure, setFailure] = useState<string | null>(null);

  // Everything the render loop reads lives in this ref, refreshed on every render.
  const scene = useRef({ props, toggles, stations, coverage });
  scene.current = { props, toggles, stations, coverage };

  const deckRef = useRef<DeckInstance | null>(null);
  const deckParentRef = useRef<HTMLDivElement | null>(null);
  const viewState = useRef<{ longitude: number; latitude: number; zoom: number } | null>(null);
  const positions = useRef(new Map<number, SatPosition>());
  const pointsRef = useRef(new Map<number, SatPoint>());
  const lastClick = useRef({ satId: -1, at: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fit = useRef<{ pending: boolean; zoom: number | null }>({ pending: true, zoom: null });
  const fontKey = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // The label atlas is rasterised once; wait for the webfont so labels do not fall back to a system face.
    void document.fonts
      ?.load('11px "B612 Mono"')
      .then(() => {
        if (!cancelled) fontKey.current = 1;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handlers = useMemo<DeckHandlers>(
    () => ({
      getTooltip(info) {
        const point =
          info.layer?.id === 'satellites' ? (info.object as SatPoint | undefined) : undefined;
        if (!point) return null;
        const sat = useFleetStore.getState().catalog[point.satId];
        const mode =
          scene.current.props.mode === 'live'
            ? telemetryStore.latest(point.satId)?.mode
            : undefined;
        const row = (label: string, value: string) =>
          `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#9a988f">${label}</span><span>${escapeHtml(value)}</span></div>`;
        return {
          html: `<div style="font-weight:700;margin-bottom:2px">${escapeHtml(point.name)}</div>${row('NORAD', String(point.satId))}${row('GROUP', sat?.group.toUpperCase() ?? '—')}${row('ALT', `${point.altKm.toFixed(0)} km`)}${mode ? row('MODE', mode) : ''}`,
          style: TOOLTIP_STYLE,
        };
      },
      onClick(info) {
        const { onSelectSat, onOpenSat, onSelectStation } = scene.current.props;
        if (info.layer?.id === 'stations' && info.object) {
          onSelectStation?.((info.object as GroundStation).id);
          return;
        }
        if (info.layer?.id !== 'satellites' || !info.object) return;
        const satId = (info.object as SatPoint).satId;
        const now = performance.now();
        const last = lastClick.current;
        if (last.satId === satId && now - last.at < DOUBLE_CLICK_MS) onOpenSat?.(satId);
        else onSelectSat?.(satId);
        lastClick.current = { satId, at: now };
      },
      onViewStateChange({ viewState: next }) {
        viewState.current = next as { longitude: number; latitude: number; zoom: number };
      },
      onError(error) {
        setFailure(error.message);
      },
    }),
    [],
  );

  useEffect(() => {
    const parent = deckParentRef.current;
    if (!parent) return;
    const deck = new Deck({
      parent,
      views: VIEW,
      initialViewState: INITIAL_VIEW_STATE,
      controller: CONTROLLER,
      getCursor: ({ isHovering, isDragging }) =>
        isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
      ...handlers,
    });
    deckRef.current = deck;
    return () => {
      deckRef.current = null;
      deck.finalize();
    };
  }, [handlers]);

  // Fit the globe to the panel: zoom so the disc fills ~75% of the shorter side, unless the user has zoomed.
  // The render loop applies it as soon as the deck instance exists.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      fit.current.pending = true;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const propagator = new FleetPropagator();
    const unackedWarnings = { source: null as unknown, ids: new Set<number>() };
    let night: { minute: number; ring: LonLat[] } | null = null;
    let track: { key: string; set: TrackSet } | null = null;
    let tick = 0;
    let lastReplayKey = '';

    const applyFit = (deck: DeckInstance) => {
      const el = containerRef.current;
      const state = fit.current;
      if (!state.pending || !el) return;
      const size = Math.min(el.clientWidth, el.clientHeight);
      if (size === 0) return;
      state.pending = false;
      const current = viewState.current;
      // Leave the zoom alone once the user has changed it.
      if (current && state.zoom !== null && Math.abs(current.zoom - state.zoom) > 0.01) return;
      state.zoom = Math.log2((size * 0.37) / GLOBE_RADIUS_PX_AT_ZOOM_0);
      const next = { ...(current ?? INITIAL_VIEW_STATE), zoom: state.zoom };
      viewState.current = next;
      deck.setProps({ initialViewState: { ...next, transitionDuration: 0 } });
    };

    const render = () => {
      const deck = deckRef.current;
      if (!deck) return;
      applyFit(deck);
      const { props: p, toggles: tg, stations: sts, coverage: cov } = scene.current;
      const fleet = useFleetStore.getState();
      propagator.sync(fleet.catalog);

      const replay = p.mode === 'replay';
      const t = replay ? (p.timeMs ?? Date.now()) : serverNow();
      const selectedId = p.selectedSatId ?? null;
      const groups = p.filterGroups && p.filterGroups.length > 0 ? new Set(p.filterGroups) : null;

      if (replay) {
        // Paused replay: nothing moves, so skip rebuilding until an input changes.
        const key = `${t}|${selectedId}|${[...(groups ?? [])]}|${JSON.stringify(tg)}|${fontKey.current}|${sts?.length}|${cov.length}|${p.highlightStationId}`;
        if (key === lastReplayKey) return;
        lastReplayKey = key;
      }

      // Unacknowledged warnings flash their satellite at 1 Hz (steady when the user prefers reduced motion).
      const alerts = useAlertsStore.getState().alerts;
      if (unackedWarnings.source !== alerts) {
        unackedWarnings.source = alerts;
        unackedWarnings.ids = new Set(
          alerts.filter((a) => a.state === 'open' && a.severity === 'WARNING').map((a) => a.satId),
        );
      }
      const flashOff = !prefersReducedMotion() && Math.floor(Date.now() / 500) % 2 === 1;

      tick++;
      const latest = positions.current;
      latest.clear();
      const points: SatPoint[] = [];
      for (const pos of propagator.positionsAt(t)) {
        latest.set(pos.satId, pos);
        const sat = fleet.catalog[pos.satId];
        if (!sat || (groups && !groups.has(sat.group))) continue;
        // Replay has no historical status, so satellites render neutral.
        const status = replay ? 'NOM' : (fleet.status[pos.satId] ?? 'NOM');
        let color: Rgba = STATUS_COLOR[status];
        if (status === 'WARN' && flashOff && unackedWarnings.ids.has(pos.satId)) {
          color = [color[0], color[1], color[2], 40];
        }
        points.push({
          satId: pos.satId,
          name: sat.name,
          position: [pos.lon, pos.lat, visualAltitudeM(pos.altKm)],
          altKm: pos.altKm,
          icon: status === 'STALE' ? 'satHollow' : 'sat',
          color,
        });
      }
      pointsRef.current = new Map(points.map((pt) => [pt.satId, pt]));
      const selected = selectedId === null ? undefined : pointsRef.current.get(selectedId);

      const layers: Layer[] = [...baseLayers()];
      if (tg.night) {
        const minute = Math.floor(t / 60_000);
        if (night?.minute !== minute) night = { minute, ring: nightPolygon(t) };
        layers.push(nightLayer(night.ring, minute));
      }
      if (tg.cov && cov.length > 0) layers.push(coverageLayer(cov));
      if (tg.gs && sts) layers.push(...stationLayers(sts, p.highlightStationId, fontKey.current));
      if (tg.trk && selectedId !== null) {
        const satrec = propagator.satrec(selectedId);
        if (satrec) {
          const key = `${selectedId}:${Math.floor(t / TRACK_REFRESH_MS)}`;
          if (track?.key !== key) {
            track = {
              key,
              set: {
                past: groundTrack(satrec, t - TRACK_PAST_MS, t, TRACK_STEP_MS),
                future: groundTrack(satrec, t, t + TRACK_FUTURE_MS, TRACK_STEP_MS),
              },
            };
          }
          layers.push(...trackLayers(track.set));
        }
      }
      layers.push(...satelliteLayers({ points, selected, fontKey: fontKey.current, tick }));
      deck.setProps({ layers });
    };

    return onFrame(render, { hz: RENDER_HZ });
  }, []);

  // Rotate to a newly selected satellite that is on the far side of the globe.
  const selectedSatId = props.selectedSatId ?? null;
  useEffect(() => {
    const deck = deckRef.current;
    const view = viewState.current;
    const pos = selectedSatId === null ? undefined : positions.current.get(selectedSatId);
    if (!deck || !view || !pos) return;
    if (separationDeg(view.longitude, view.latitude, pos.lon, pos.lat) < FOCUS_THRESHOLD_DEG)
      return;
    // Take the short way round the antimeridian.
    const delta = ((((pos.lon - view.longitude + 180) % 360) + 360) % 360) - 180;
    deck.setProps({
      initialViewState: {
        ...view,
        longitude: view.longitude + delta,
        latitude: pos.lat,
        transitionDuration: prefersReducedMotion() ? 0 : 700,
        transitionInterpolator: new LinearInterpolator(['longitude', 'latitude']),
      },
    });
  }, [selectedSatId]);

  return (
    <div
      ref={containerRef}
      className={cx('relative h-full min-h-24 w-full overflow-hidden bg-bg', className)}
    >
      {failure ? (
        <ErrorState title="GLOBE UNAVAILABLE" error={failure} />
      ) : (
        <div ref={deckParentRef} className="absolute inset-0 [&>canvas]:top-0 [&>canvas]:left-0" />
      )}
      <div className="pointer-events-none absolute inset-x-1 top-1 flex items-start justify-between">
        <div className="pointer-events-auto">
          <GlobeToggles value={toggles} onChange={setToggles} />
        </div>
        {catalogSize === 0 && (
          <span className="mnemonic border border-rule bg-panel px-1 py-0.5 text-xs text-text-2">
            ACQUIRING…
          </span>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-1 bottom-1 flex items-end justify-between">
        <GlobeLegend />
        <span className="mnemonic text-2xs text-text-dim">NATURAL EARTH</span>
      </div>
    </div>
  );
}
