// DEVICES: ingest API keys. Create (key shown once) and revoke (confirmed).
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatUtcDateTime } from '../../lib/formatTime.ts';
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Panel,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../ui/index.ts';
import {
  adminKeys,
  createDevice,
  deleteDevice,
  describeError,
  fetchDevices,
  type DeviceRecord,
} from './adminApi.ts';
import { parseAllowedSources } from './forms.ts';
import { KeyReveal } from './KeyReveal.tsx';

export function DevicesPanel() {
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: adminKeys.devices, queryFn: fetchDevices });
  const [name, setName] = useState('');
  const [sources, setSources] = useState('');
  const [errors, setErrors] = useState<{ name?: string; sources?: string }>({});
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<DeviceRecord | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: adminKeys.devices });
  const create = useMutation({
    mutationFn: ({ name, sources }: { name: string; sources: string[] }) =>
      createDevice(name, sources),
    onSuccess: ({ device, key }) => {
      setIssued({ name: device.name, key });
      setName('');
      setSources('');
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => deleteDevice(id),
    onSuccess: () => setRevoking(null),
    onSettled: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsedSources = parseAllowedSources(sources);
    const nextErrors = {
      name:
        name.trim() === '' ? 'NAME REQUIRED' : name.trim().length > 100 ? 'TOO LONG' : undefined,
      sources: parsedSources.ok ? undefined : parsedSources.errors.sources,
    };
    setErrors(nextErrors);
    if (nextErrors.name || !parsedSources.ok) return;
    create.mutate({ name: name.trim(), sources: parsedSources.value });
  };

  return (
    <Panel title="DEVICES" subtitle="INGEST API KEYS" flush bodyClassName="flex min-h-0 flex-col">
      {issued && (
        <KeyReveal deviceName={issued.name} secret={issued.key} onDismiss={() => setIssued(null)} />
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {devices.isPending ? (
          <LoadingState label="LOADING DEVICES" />
        ) : devices.isError ? (
          <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
        ) : devices.data.length === 0 ? (
          <p className="mnemonic p-1 text-xs text-text-dim">NO DEVICE KEYS ISSUED</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>NAME</TH>
                <TH>ALLOWED SOURCES</TH>
                <TH>LAST SEEN (UTC)</TH>
                <TH>CREATED (UTC)</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {devices.data.map((d) => (
                <TR key={d.id}>
                  <TD>{d.name}</TD>
                  <TD className="num text-xs" title={d.allowedSources.join(', ')}>
                    {d.allowedSources.join(', ')}
                  </TD>
                  <TD className="num text-xs text-text-2">
                    {d.lastSeenAt ? (
                      formatUtcDateTime(d.lastSeenAt)
                    ) : (
                      <span className="text-text-dim">NEVER</span>
                    )}
                  </TD>
                  <TD className="num text-xs text-text-2">
                    {d.createdAt ? formatUtcDateTime(d.createdAt) : '—'}
                  </TD>
                  <TD>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        revoke.reset();
                        setRevoking(d);
                      }}
                      aria-label={`Revoke ${d.name}`}
                    >
                      REVOKE
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <form onSubmit={submit} noValidate className="shrink-0 border-t border-rule p-1">
        <h3 className="mnemonic pb-1 text-xs text-text-2">ISSUE DEVICE KEY</h3>
        <div className="grid grid-cols-1 gap-x-1 gap-y-1 sm:grid-cols-2">
          <Field label="NAME" error={errors.name}>
            {(id) => (
              <Input
                id={id}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="ALLOWED SOURCES"
            error={errors.sources}
            hint="Comma-separated, e.g. sat-25544, sat-43013. Blank = all (*)."
          >
            {(id) => (
              <Input
                id={id}
                autoComplete="off"
                placeholder="*"
                value={sources}
                onChange={(e) => setSources(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex items-center gap-1 pt-1">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'ISSUING…' : 'ISSUE KEY'}
          </Button>
          {create.isError && (
            <span role="alert" className="mnemonic text-xs text-warning">
              {describeError(create.error)}
            </span>
          )}
        </div>
      </form>

      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="REVOKE DEVICE KEY"
        description={`Revoke the key for "${revoking?.name ?? ''}"? Devices using it are refused on their next connection. This cannot be undone.`}
      >
        <div className="flex items-center justify-end gap-1">
          {revoke.isError && (
            <span role="alert" className="mnemonic mr-auto text-xs text-warning">
              {describeError(revoke.error)}
            </span>
          )}
          <Button onClick={() => setRevoking(null)}>CANCEL</Button>
          <Button
            variant="danger"
            disabled={revoke.isPending}
            onClick={() => revoking && revoke.mutate(revoking.id)}
          >
            {revoke.isPending ? 'REVOKING…' : 'REVOKE KEY'}
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}
