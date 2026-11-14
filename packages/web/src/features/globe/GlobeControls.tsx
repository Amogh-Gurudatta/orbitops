// Overlay controls for the globe: layer toggles (top-left) and the colour legend (bottom). Plain caps text, no
// icons; a pressed toggle inverts to white like the SegmentedControl.
import { cx } from '../../lib/cx.ts';
import { STATUS_CSS } from './palette.ts';

export interface LayerToggles {
  trk: boolean;
  gs: boolean;
  cov: boolean;
  night: boolean;
}

const TOGGLES: readonly { key: keyof LayerToggles; label: string; title: string }[] = [
  { key: 'trk', label: 'TRK', title: 'Ground tracks of the selected satellite' },
  { key: 'gs', label: 'GS', title: 'Ground stations' },
  { key: 'cov', label: 'COV', title: 'Ground-station coverage (H3)' },
  { key: 'night', label: 'NIGHT', title: 'Day/night terminator' },
];

export function GlobeToggles({
  value,
  onChange,
}: {
  value: LayerToggles;
  onChange(next: LayerToggles): void;
}) {
  return (
    <div role="group" aria-label="Globe layers" className="inline-flex border border-rule bg-panel">
      {TOGGLES.map((t) => (
        <button
          key={t.key}
          type="button"
          title={t.title}
          aria-pressed={value[t.key]}
          onClick={() => onChange({ ...value, [t.key]: !value[t.key] })}
          className={cx(
            'mnemonic h-[22px] border-r border-rule px-1 text-xs last:border-r-0',
            value[t.key] ? 'bg-text text-bg' : 'text-text-dim hover:text-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const LEGEND: readonly { code: string; color: string; hollow?: boolean }[] = [
  { code: 'NOM', color: STATUS_CSS.NOM },
  { code: 'CAUT', color: STATUS_CSS.CAUT },
  { code: 'WARN', color: STATUS_CSS.WARN },
  { code: 'STALE', color: STATUS_CSS.STALE, hollow: true },
];

export function GlobeLegend() {
  return (
    <div className="flex h-3 items-center gap-2 border border-rule bg-panel px-1">
      {LEGEND.map((l) => (
        <span key={l.code} className="mnemonic flex items-center gap-0.5 text-2xs text-text-2">
          <span
            aria-hidden="true"
            className="inline-block h-[8px] w-[8px] rotate-45 border"
            style={{ borderColor: l.color, backgroundColor: l.hollow ? 'transparent' : l.color }}
          />
          {l.code}
        </span>
      ))}
      <span className="mnemonic flex items-center gap-0.5 text-2xs text-text-2">
        <span
          aria-hidden="true"
          className="inline-block h-0 w-2 border-t border-dashed border-predicted"
        />
        PRED
      </span>
    </div>
  );
}
