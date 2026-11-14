// Virtualized alarm list: only the rows in view are mounted, so thousands of alerts stay cheap.
// Div-grid with ARIA table roles (a real <table> cannot be absolutely positioned per row).
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Alert } from '@orbitops/shared';
import { cx } from '../../lib/cx.ts';
import { formatUtcDateTime, formatUtcTime } from '../../lib/formatTime.ts';
import { ROW_HEIGHT } from '../../ui/index.ts';
import { SevChip } from './SevChip.tsx';

const COLUMNS = [
  { key: 'opened', label: 'OPENED (UTC)', width: '112px' },
  { key: 'seen', label: 'LAST SEEN', width: '64px' },
  { key: 'sev', label: 'SEV', width: '40px' },
  { key: 'sat', label: 'SAT', width: '152px' },
  { key: 'sub', label: 'SUBSYS', width: '56px' },
  { key: 'rule', label: 'RULE', width: '128px' },
  { key: 'msg', label: 'MESSAGE', width: 'minmax(160px, 1fr)' },
  { key: 'val', label: 'VALUE / LIMIT', width: '112px', numeric: true },
  { key: 'count', label: 'CNT', width: '40px', numeric: true },
  { key: 'state', label: 'STATE', width: '56px' },
  { key: 'ackBy', label: 'ACK BY', width: '88px' },
] as const;

const GRID = COLUMNS.map((c) => c.width).join(' ');
const MIN_WIDTH = 968;
const END_THRESHOLD = 8;

export interface AlertTableProps {
  rows: readonly Alert[];
  selectedId: string | null;
  onSelect(id: string): void;
  satLabel(satId: number): string;
  onEndReached(): void;
  loadingMore: boolean;
}

const fmt = (value: number | null) =>
  value === null ? '—' : Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);

export function AlertTable({
  rows,
  selectedId,
  onSelect,
  satLabel,
  onEndReached,
  loadingMore,
}: AlertTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => rows[index]!.id,
  });
  const items = virtualizer.getVirtualItems();

  const lastIndex = items.at(-1)?.index ?? -1;
  useEffect(() => {
    if (rows.length > 0 && lastIndex >= rows.length - END_THRESHOLD) onEndReached();
  }, [lastIndex, rows.length, onEndReached]);

  // Keyboard navigation keeps the selection in view.
  const selectedIndex = selectedId === null ? -1 : rows.findIndex((r) => r.id === selectedId);
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto"
      role="table"
      aria-label="Alarm list"
      aria-rowcount={rows.length}
    >
      <div style={{ minWidth: MIN_WIDTH }}>
        <div
          role="row"
          className="mnemonic sticky top-0 z-1 grid h-3 items-center gap-x-1 border-b border-rule bg-panel px-1 text-xs text-text-2"
          style={{ gridTemplateColumns: GRID }}
        >
          {COLUMNS.map((c) => (
            <span
              key={c.key}
              role="columnheader"
              className={cx('truncate', 'numeric' in c && c.numeric && 'text-right')}
            >
              {c.label}
            </span>
          ))}
        </div>
        <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const alert = rows[item.index]!;
            return (
              <AlertRow
                key={item.key}
                alert={alert}
                index={item.index}
                top={item.start}
                selected={alert.id === selectedId}
                satLabel={satLabel(alert.satId)}
                onSelect={onSelect}
              />
            );
          })}
        </div>
        {loadingMore && (
          <p className="mnemonic h-3 px-1 text-xs leading-[24px] text-text-dim">LOADING OLDER…</p>
        )}
      </div>
    </div>
  );
}

interface AlertRowProps {
  alert: Alert;
  index: number;
  top: number;
  selected: boolean;
  satLabel: string;
  onSelect(id: string): void;
}

function AlertRow({ alert, index, top, selected, satLabel, onSelect }: AlertRowProps) {
  const resolved = alert.state === 'resolved';
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      onClick={() => onSelect(alert.id)}
      className={cx(
        'num absolute inset-x-0 grid h-3 cursor-pointer items-center gap-x-1 border-b border-grid px-1 text-xs hover:bg-grid',
        resolved ? 'text-text-dim' : 'text-text',
        selected && 'outline outline-1 -outline-offset-1 outline-select',
      )}
      style={{ gridTemplateColumns: GRID, top }}
    >
      <span role="cell" className="truncate">
        {formatUtcDateTime(alert.openedAt)}
      </span>
      <span
        role="cell"
        className="truncate text-text-2"
        title={formatUtcDateTime(alert.lastSeenAt)}
      >
        {formatUtcTime(alert.lastSeenAt)}
      </span>
      <span role="cell">
        <SevChip severity={alert.severity} flashing={alert.state === 'open'} muted={resolved} />
      </span>
      <span role="cell" className="truncate">
        <Link
          to={`/sat/${alert.satId}`}
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
        >
          {satLabel}
        </Link>
      </span>
      <span role="cell" className="mnemonic">
        {alert.subsystem}
      </span>
      <span role="cell" className="truncate text-text-2" title={alert.ruleId}>
        {alert.ruleId}
      </span>
      <span role="cell" className="truncate font-sans" title={alert.message}>
        {alert.message}
      </span>
      <span role="cell" className="truncate text-right">
        {fmt(alert.value)}
        <span className="text-text-dim"> / {fmt(alert.threshold)}</span>
      </span>
      <span role="cell" className="text-right">
        {alert.count}
      </span>
      <span role="cell" className="mnemonic">
        {alert.state.toUpperCase()}
      </span>
      <span role="cell" className="truncate text-text-2" title={alert.ackedBy}>
        {alert.ackedBy ?? '—'}
      </span>
    </div>
  );
}
