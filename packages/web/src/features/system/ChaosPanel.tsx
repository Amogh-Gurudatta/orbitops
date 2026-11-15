// DEFENCES: the chaos switch. When enabled the simulator injects duplicate, out-of-order and malformed
// events; the live DUP / OOO / MALF rates beside it show the pipeline absorbing them. Admin only.
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChaosConfig } from '@orbitops/shared';
import { useSession } from '../../auth/AuthContext.tsx';
import { cx } from '../../lib/cx.ts';
import { Button, ErrorState, Input, LoadingState, Panel, Switch, Tooltip } from '../../ui/index.ts';
import { fetchChaos, MAX_CHAOS_RATE, systemKeys, updateChaos } from './systemApi.ts';
import type { StatsHistory } from './statsHistory.ts';
import { StatLine } from './StatLine.tsx';

type RateKey = 'duplicateRate' | 'reorderRate' | 'malformedRate';

const RATES: {
  key: RateKey;
  label: string;
  counter: 'duplicates' | 'outOfOrder' | 'malformed';
  short: string;
}[] = [
  { key: 'duplicateRate', label: 'DUPLICATE RATE', counter: 'duplicates', short: 'DUP' },
  { key: 'reorderRate', label: 'REORDER RATE', counter: 'outOfOrder', short: 'OOO' },
  { key: 'malformedRate', label: 'MALFORMED RATE', counter: 'malformed', short: 'MALF' },
];

/** Non-admins see the control disabled, with the reason on hover. */
function AuthorityGate({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  if (allowed) return children;
  return (
    <Tooltip content="ADMIN AUTHORITY REQUIRED">
      <span tabIndex={0} className="inline-block">
        {children}
      </span>
    </Tooltip>
  );
}

const clampRate = (value: number) => Math.min(MAX_CHAOS_RATE, Math.max(0, value));

export function ChaosPanel({ history }: { history: StatsHistory }) {
  const { can } = useSession();
  const isAdmin = can('admin');
  const queryClient = useQueryClient();
  const chaos = useQuery({
    queryKey: systemKeys.chaos,
    queryFn: fetchChaos,
    refetchInterval: 5000,
  });
  const [draft, setDraft] = useState<ChaosConfig | null>(null);

  const mutation = useMutation({
    mutationFn: updateChaos,
    onSuccess: (saved) => {
      queryClient.setQueryData(systemKeys.chaos, saved);
      setDraft(null);
    },
  });

  const config = draft ?? chaos.data;
  const dirty =
    draft !== null &&
    chaos.data !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(chaos.data);

  const edit = (patch: Partial<ChaosConfig>) => config && setDraft({ ...config, ...patch });
  const toggle = (enabled: boolean) => config && mutation.mutate({ ...config, enabled });

  return (
    <Panel
      title="DEFENCES"
      subtitle="CHAOS INJECTION"
      flush
      bodyClassName="flex flex-col overflow-auto"
    >
      {chaos.isPending ? (
        <LoadingState label="READING CHAOS CONFIG" />
      ) : chaos.isError || !config ? (
        <ErrorState error={chaos.error} onRetry={() => void chaos.refetch()} />
      ) : (
        <>
          <div className="flex h-4 items-center gap-1 border-b border-grid px-1" data-tour="chaos">
            <span className="mnemonic flex-1 text-xs text-text-2">CHAOS</span>
            <span
              className={cx('mnemonic text-xs', config.enabled ? 'text-caution' : 'text-text-dim')}
            >
              {config.enabled ? 'ON — INJECTING FAULTS' : 'OFF'}
            </span>
            <AuthorityGate allowed={isAdmin}>
              <fieldset disabled={!isAdmin || mutation.isPending} className="contents">
                <Switch label="Chaos enabled" checked={config.enabled} onCheckedChange={toggle} />
              </fieldset>
            </AuthorityGate>
          </div>

          {RATES.map(({ key, label }) => (
            <div
              key={key}
              className="grid h-4 grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-x-1 border-b border-grid px-1"
            >
              <span className="mnemonic text-xs text-text-2">{label}</span>
              <input
                type="range"
                min={0}
                max={MAX_CHAOS_RATE}
                step={0.01}
                value={config[key]}
                disabled={!isAdmin}
                aria-label={`${label} slider`}
                className="h-2 w-full accent-trace disabled:opacity-40"
                onChange={(e) => edit({ [key]: clampRate(Number(e.target.value)) })}
              />
              <Input
                type="number"
                min={0}
                max={MAX_CHAOS_RATE}
                step={0.01}
                value={config[key]}
                disabled={!isAdmin}
                aria-label={`${label} value`}
                className="h-[22px] px-0.5 text-right text-xs"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) edit({ [key]: clampRate(n) });
                }}
              />
            </div>
          ))}

          <div className="flex h-4 items-center gap-1 border-b border-grid px-1">
            <Button
              size="sm"
              variant="primary"
              disabled={!isAdmin || !dirty || mutation.isPending}
              onClick={() => mutation.mutate(config)}
            >
              APPLY
            </Button>
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(null)}>
              REVERT
            </Button>
            {!isAdmin && (
              <span className="mnemonic text-xs text-text-dim">ADMIN AUTHORITY REQUIRED</span>
            )}
            {mutation.isError && (
              <span role="alert" className="mnemonic text-xs text-warning">
                {mutation.error.message.toUpperCase()}
              </span>
            )}
          </div>
        </>
      )}

      <p className="mnemonic border-b border-grid px-1 py-0.5 text-2xs text-text-dim">
        LIVE REJECTION RATE
      </p>
      {RATES.map(({ counter, short }) => (
        <StatLine
          key={counter}
          label={`${short} / S`}
          value={history.latestRate(counter).toFixed(1)}
          unit="ev/s"
        />
      ))}
      <p className="px-1 py-1 text-xs text-text-2">
        Chaos makes the simulator send duplicate, out-of-order and malformed events. The pipeline
        rejects or reorders them; dashboards stay clean.
      </p>
    </Panel>
  );
}
