// Filter bar: dense toggles for state / severity / subsystem plus a SAT text box. Controlled by the URL.
import { useState } from 'react';
import { SEVERITIES, SUBSYSTEMS, type Severity, type Subsystem } from '@orbitops/shared';
import { Input, SegmentedControl } from '../../ui/index.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { STATE_FILTERS, type AlertFilters, type StateFilter } from './filters.ts';
import { resolveSatId } from './satLookup.ts';

const STATE_OPTIONS = STATE_FILTERS.map((s) => ({ value: s, label: s.toUpperCase() }));
const SEV_LABEL: Record<Severity, string> = { WARNING: 'WARN', CAUTION: 'CAUT', ADVISORY: 'ADV' };
const SEV_OPTIONS = [
  { value: 'ALL', label: 'ALL' },
  ...SEVERITIES.map((s) => ({ value: s, label: SEV_LABEL[s] })),
];
const SUBSYS_OPTIONS = [
  { value: 'ALL', label: 'ALL' },
  ...SUBSYSTEMS.map((s) => ({ value: s, label: s })),
];

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="mnemonic text-xs text-text-dim">{label}</span>
      {children}
    </div>
  );
}

export function AlertFilterBar({
  filters,
  onChange,
}: {
  filters: AlertFilters;
  onChange(next: AlertFilters): void;
}) {
  const catalog = useFleetStore((s) => s.catalog);
  const [draft, setDraft] = useState(filters.satId === null ? '' : String(filters.satId));
  const [satError, setSatError] = useState(false);

  const commitSat = () => {
    if (draft.trim() === '') {
      setSatError(false);
      if (filters.satId !== null) onChange({ ...filters, satId: null });
      return;
    }
    const satId = resolveSatId(draft, catalog);
    setSatError(satId === null);
    if (satId !== null) {
      setDraft(String(satId));
      onChange({ ...filters, satId });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Group label="STATE">
        <SegmentedControl<StateFilter>
          aria-label="Alert state filter"
          value={filters.state}
          onValueChange={(state) => onChange({ ...filters, state })}
          options={STATE_OPTIONS}
        />
      </Group>
      <Group label="SEV">
        <SegmentedControl
          aria-label="Severity filter"
          value={filters.severity ?? 'ALL'}
          onValueChange={(v) =>
            onChange({ ...filters, severity: v === 'ALL' ? null : (v as Severity) })
          }
          options={SEV_OPTIONS}
        />
      </Group>
      <Group label="SUBSYS">
        <SegmentedControl
          aria-label="Subsystem filter"
          value={filters.subsystem ?? 'ALL'}
          onValueChange={(v) =>
            onChange({ ...filters, subsystem: v === 'ALL' ? null : (v as Subsystem) })
          }
          options={SUBSYS_OPTIONS}
        />
      </Group>
      <Group label="SAT">
        <Input
          aria-label="Satellite filter (NORAD id or name)"
          aria-invalid={satError}
          placeholder="NORAD / NAME"
          value={draft}
          className={satError ? 'h-[22px] w-24 border-warning' : 'h-[22px] w-24'}
          onChange={(e) => {
            setDraft(e.target.value);
            setSatError(false);
          }}
          onBlur={commitSat}
          onKeyDown={(e) => e.key === 'Enter' && commitSat()}
        />
        {satError && <span className="mnemonic text-xs text-warning">NO MATCH</span>}
      </Group>
    </div>
  );
}
