// COMMANDS: operator/admin only (viewers see a locked panel). Fault injection asks for confirmation;
// every command is audited server side and listed in the log below with its delivery status.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FAULT_KINDS, type Command, type FaultKind } from '@orbitops/shared';
import { useSession } from '../../auth/AuthContext.tsx';
import { ApiError } from '../../api/client.ts';
import { cx } from '../../lib/cx.ts';
import {
  Button,
  Dialog,
  Icon,
  Panel,
  SegmentedControl,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tag,
  type TagTone,
} from '../../ui/index.ts';
import { formatUtcTime } from './passes.ts';
import { fetchCommands, satelliteKeys, sendCommand } from './satelliteApi.ts';

const FAULT_OPTIONS = FAULT_KINDS.map((f): { value: FaultKind; label: string } => ({
  value: f,
  label: f === 'battery' ? 'BATT' : f.toUpperCase(),
}));
const LOG_REFRESH_MS = 5000;

const STATUS_TONE: Record<string, TagTone> = {
  sent: 'neutral',
  acked: 'neutral',
  applied: 'neutral',
  no_device: 'caution',
  failed: 'warning',
};

function commandLabel(c: Pick<Command, 'kind' | 'fault'>): string {
  switch (c.kind) {
    case 'inject_fault':
      return `INJECT ${c.fault?.toUpperCase() ?? ''}`.trim();
    case 'clear_fault':
      return 'CLEAR FAULT';
    case 'safe_mode':
      return 'SAFE MODE';
    case 'nominal_mode':
      return 'NOMINAL MODE';
  }
}

export function CommandsPanel({ satId, satName }: { satId: number; satName: string }) {
  const { can } = useSession();
  if (!can('operator')) {
    return (
      <Panel title="COMMANDS" subtitle="LOCKED">
        <div className="hatch flex h-full min-h-[96px] flex-col items-start justify-center gap-1 border border-rule p-2">
          <Icon name="lock" size={16} className="text-text-2" />
          <span className="mnemonic text-sm text-text-2">OPERATOR AUTHORITY REQUIRED</span>
          <p className="text-xs text-text-dim">
            Fault injection and mode commands are limited to operator and admin roles.
          </p>
        </div>
      </Panel>
    );
  }
  return <OperatorCommands satId={satId} satName={satName} />;
}

function OperatorCommands({ satId, satName }: { satId: number; satName: string }) {
  const queryClient = useQueryClient();
  const [fault, setFault] = useState<FaultKind>('thermal');
  const [confirming, setConfirming] = useState(false);

  const log = useQuery({
    queryKey: satelliteKeys.commands(satId),
    queryFn: () => fetchCommands(satId),
    refetchInterval: LOG_REFRESH_MS,
  });
  const send = useMutation({
    mutationFn: sendCommand,
    onSettled: () => queryClient.invalidateQueries({ queryKey: satelliteKeys.commands(satId) }),
  });

  const issue = (command: Omit<Command, 'satId'>) => send.mutate({ satId, ...command } as Command);
  const pending = send.isPending;

  return (
    <Panel title="COMMANDS" subtitle={satName} flush bodyClassName="flex flex-col">
      <div className="flex flex-col gap-1 border-b border-rule p-1" data-tour="sat-commands">
        <div className="flex items-center gap-1">
          <SegmentedControl<FaultKind>
            aria-label="Fault type"
            value={fault}
            onValueChange={setFault}
            options={FAULT_OPTIONS}
          />
          <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirming(true)}>
            INJECT FAULT
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" disabled={pending} onClick={() => issue({ kind: 'clear_fault' })}>
            CLEAR FAULT
          </Button>
          <Button size="sm" disabled={pending} onClick={() => issue({ kind: 'safe_mode' })}>
            SAFE MODE
          </Button>
          <Button size="sm" disabled={pending} onClick={() => issue({ kind: 'nominal_mode' })}>
            NOMINAL MODE
          </Button>
        </div>
        {send.isError && (
          <p role="alert" className="mnemonic text-xs text-warning">
            COMMAND REJECTED // {send.error instanceof ApiError ? send.error.message : 'LINK FAULT'}
          </p>
        )}
      </div>

      <div className="min-h-[96px] flex-1 overflow-auto">
        {log.data && log.data.length === 0 ? (
          <p className="mnemonic p-1 text-xs text-text-dim">NO COMMANDS ISSUED</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>UTC</TH>
                <TH>COMMAND</TH>
                <TH>BY</TH>
                <TH>STATUS</TH>
              </tr>
            </THead>
            <TBody>
              {(log.data ?? []).slice(0, 20).map((c) => (
                <TR key={c.id}>
                  <TD className="num">{formatUtcTime(c.issuedAt)}</TD>
                  <TD className={cx('mnemonic text-xs', c.kind === 'inject_fault' && 'text-text')}>
                    {commandLabel(c)}
                  </TD>
                  <TD className="max-w-[72px] text-text-2">{c.issuedBy.split('@')[0]}</TD>
                  <TD>
                    <Tag tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status.toUpperCase()}</Tag>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="CONFIRM FAULT INJECTION"
        description={`This will degrade ${satName} telemetry (${fault.toUpperCase()} fault) until cleared.`}
      >
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={() => setConfirming(false)}>
            CANCEL
          </Button>
          <Button
            variant="danger"
            size="sm"
            autoFocus
            onClick={() => {
              setConfirming(false);
              issue({ kind: 'inject_fault', fault });
            }}
          >
            INJECT {fault.toUpperCase()}
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}
