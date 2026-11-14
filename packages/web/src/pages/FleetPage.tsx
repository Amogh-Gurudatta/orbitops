// Fleet Overview (/): the console's home screen. A draggable, resizable panel grid (layout persisted locally):
// pipeline strip, globe, fleet table, alarm log and the selected-satellite readouts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import ReactGridLayout, { useContainerWidth, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { FLEET_ROOM } from '@orbitops/shared';
import { AlarmLog } from '../features/fleet/AlarmLog.tsx';
import { FleetTable } from '../features/fleet/FleetTable.tsx';
import {
  clearLayout,
  DEFAULT_LAYOUT,
  GRID_COLS,
  GRID_ROWS,
  loadLayout,
  NARROW_LAYOUT,
  saveLayout,
  type PanelId,
} from '../features/fleet/layout.ts';
import { PipelineStrip } from '../features/fleet/PipelineStrip.tsx';
import { SelectedPanel } from '../features/fleet/SelectedPanel.tsx';
import { useFleetRows } from '../features/fleet/useFleetRows.ts';
import { Globe } from '../features/globe/Globe.tsx';
import { useAlertsStore } from '../realtime/alertsStore.ts';
import { useFleetStore } from '../realtime/fleetStore.ts';
import { useSubscription } from '../realtime/useRealtime.ts';
import { Button, EmptyState, Panel } from '../ui/index.ts';

const MARGIN = 8;
const NARROW_BELOW_PX = 1000;
const NARROW_ROW_HEIGHT = 24;
const MIN_ROW_HEIGHT = 16;

/** Height available to the grid, tracked so the 24 rows fill the page exactly. */
function useElementHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);
  return { ref, height };
}

export function Component() {
  const navigate = useNavigate();
  // The fleet room keeps positions and status live; snapshots fill in the table's power/thermal/link columns.
  useSubscription([FLEET_ROOM], 1);

  const rows = useFleetRows();
  const selectedSatId = useFleetStore((s) => s.selectedSatId);
  const selectSat = useFleetStore((s) => s.selectSat);
  const unacked = useAlertsStore((s) => s.summary.unackedTotal);
  const open = useCallback((satId: number) => navigate(`/sat/${satId}`), [navigate]);

  const { width, containerRef, mounted } = useContainerWidth();
  const { ref: heightRef, height } = useElementHeight();
  const narrow = width < NARROW_BELOW_PX;
  const [layout, setLayout] = useState(loadLayout);

  const rowHeight = narrow
    ? NARROW_ROW_HEIGHT
    : Math.max(MIN_ROW_HEIGHT, Math.floor((height - MARGIN * (GRID_ROWS - 1)) / GRID_ROWS));
  const activeLayout = narrow ? NARROW_LAYOUT : layout;

  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (!narrow) saveLayout(next);
    },
    [narrow],
  );
  const resetLayout = useCallback(() => {
    clearLayout();
    setLayout([...DEFAULT_LAYOUT]);
  }, []);

  const panels = useMemo<Record<PanelId, ReactNode>>(
    () => ({
      pipeline: (
        <Panel
          title="PIPELINE"
          draggable={!narrow}
          flush
          controls={
            <Button size="sm" variant="ghost" onClick={resetLayout}>
              RESET LAYOUT
            </Button>
          }
        >
          <PipelineStrip />
        </Panel>
      ),
      globe: (
        <Panel title="GLOBE" subtitle="LIVE · SGP4 PROPAGATION" draggable={!narrow} flush>
          <Globe
            mode="live"
            selectedSatId={selectedSatId}
            onSelectSat={selectSat}
            onOpenSat={open}
            showStations
          />
        </Panel>
      ),
      fleet: (
        <Panel title="FLEET" subtitle={`${rows.length} SATELLITES`} draggable={!narrow} flush>
          <FleetTable
            rows={rows}
            selectedSatId={selectedSatId}
            onSelect={selectSat}
            onOpen={open}
          />
        </Panel>
      ),
      alarms: (
        <Panel
          title="ALARM LOG"
          subtitle={unacked > 0 ? `${unacked} UNACKNOWLEDGED` : undefined}
          state={unacked > 0 ? 'warning' : undefined}
          draggable={!narrow}
          flush
        >
          <AlarmLog onSelectSat={selectSat} />
        </Panel>
      ),
      selected: (
        <Panel title="SELECTED" draggable={!narrow} flush>
          {selectedSatId === null ? (
            <EmptyState
              title="NO SATELLITE SELECTED"
              detail="Click a marker on the globe or a row in the fleet table."
            />
          ) : (
            <SelectedPanel satId={selectedSatId} />
          )}
        </Panel>
      ),
    }),
    [narrow, rows, selectedSatId, selectSat, open, unacked, resetLayout],
  );

  return (
    <div ref={heightRef} className="h-full min-h-0">
      <div ref={containerRef} className="min-h-full">
        {mounted && height > 0 && (
          <ReactGridLayout
            width={width}
            layout={activeLayout.map((p) => ({ ...p }))}
            gridConfig={{
              cols: narrow ? 1 : GRID_COLS,
              rowHeight,
              margin: [MARGIN, MARGIN],
              containerPadding: [0, 0],
            }}
            dragConfig={{ enabled: !narrow, handle: '.panel-drag' }}
            resizeConfig={{ enabled: !narrow }}
            onLayoutChange={onLayoutChange}
          >
            {activeLayout.map((p) => (
              <div key={p.i}>{panels[p.i]}</div>
            ))}
          </ReactGridLayout>
        )}
      </div>
    </div>
  );
}
