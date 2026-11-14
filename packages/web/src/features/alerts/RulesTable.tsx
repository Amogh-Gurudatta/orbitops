// Alert rules: read-only for everyone, inline-editable for admins (threshold, severity, enabled,
// samples, clearRatio, windowSize). Edits are optimistic and roll back if the server refuses them.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SEVERITIES, type AlertRule, type Severity } from '@orbitops/shared';
import { cx } from '../../lib/cx.ts';
import {
  ErrorState,
  Input,
  LoadingState,
  Panel,
  Select,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../ui/index.ts';
import { alertKeys, fetchRules, updateRule, type RulePatch } from './alertsApi.ts';
import { isFieldApplicable, validateRuleField, type EditableNumberField } from './rules.ts';

const SEV_OPTIONS = SEVERITIES.map((s) => ({ value: s, label: s }));

function NumberCell({
  rule,
  field,
  editable,
  onCommit,
}: {
  rule: AlertRule;
  field: EditableNumberField;
  editable: boolean;
  onCommit(patch: RulePatch): void;
}) {
  const value = rule[field];
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [error, setError] = useState<string | null>(null);

  if (!isFieldApplicable(rule, field)) return <span className="text-text-dim">—</span>;
  if (!editable) return <>{value ?? <span className="text-text-dim">—</span>}</>;

  const commit = () => {
    if (draft === (value === undefined ? '' : String(value))) return setError(null);
    const result = validateRuleField(field, draft);
    if (!result.ok) return setError(result.error);
    setError(null);
    onCommit({ [field]: result.value });
  };

  return (
    <Input
      aria-label={`${rule.id} ${field}`}
      aria-invalid={error !== null}
      title={error ?? undefined}
      value={draft}
      inputMode="decimal"
      placeholder="DEFAULT"
      className={cx('h-[22px] w-[72px]! px-0.5 text-right text-xs', error && 'border-warning')}
      onChange={(e) => {
        setDraft(e.target.value);
        setError(null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value === undefined ? '' : String(value));
          setError(null);
        }
      }}
    />
  );
}

export function RulesTable({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const rules = useQuery({ queryKey: alertKeys.rules, queryFn: fetchRules });

  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RulePatch }) => updateRule(id, patch),
    onMutate: async ({ id, patch }) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: alertKeys.rules });
      const previous = queryClient.getQueryData<AlertRule[]>(alertKeys.rules);
      queryClient.setQueryData<AlertRule[]>(alertKeys.rules, (list) =>
        list?.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
      );
      return { previous };
    },
    onError: (err, vars, context) => {
      queryClient.setQueryData(alertKeys.rules, context?.previous);
      setError(`${vars.id}: ${err instanceof Error ? err.message : 'UPDATE FAILED'}`);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: alertKeys.rules }),
  });

  const edit = (id: string) => (patch: RulePatch) => mutation.mutate({ id, patch });

  return (
    <Panel
      title="DETECTION RULES"
      subtitle={
        canEdit
          ? 'EDIT IN PLACE · ENTER COMMITS · ESC REVERTS'
          : 'READ ONLY · ADMIN AUTHORITY TO EDIT'
      }
      flush
      bodyClassName="flex min-h-0 flex-col"
    >
      {error && (
        <p role="alert" className="mnemonic border-b border-rule px-1 py-0.5 text-xs text-warning">
          REJECTED — {error.toUpperCase()} — CHANGE ROLLED BACK
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {rules.isPending ? (
          <LoadingState label="LOADING RULES" />
        ) : rules.isError ? (
          <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
        ) : (
          <Table className="min-w-[1080px]">
            <THead>
              <TR>
                <TH>RULE ID</TH>
                <TH>NAME</TH>
                <TH>SUBSYS</TH>
                <TH>SEVERITY</TH>
                <TH>KIND</TH>
                <TH>METRIC</TH>
                <TH>OP</TH>
                <TH numeric>THRESHOLD</TH>
                <TH numeric>SAMPLES</TH>
                <TH numeric>CLEAR RATIO</TH>
                <TH numeric>WINDOW</TH>
                <TH>ENABLED</TH>
              </TR>
            </THead>
            <TBody>
              {rules.data.map((rule) => (
                <TR key={rule.id} className={cx(!rule.enabled && 'text-text-dim')}>
                  <TD className="num text-xs">{rule.id}</TD>
                  <TD>{rule.name}</TD>
                  <TD className="mnemonic text-xs">{rule.subsystem}</TD>
                  <TD className="overflow-visible">
                    {canEdit ? (
                      <Select
                        aria-label={`${rule.id} severity`}
                        value={rule.severity}
                        options={SEV_OPTIONS}
                        className="h-[22px] w-14"
                        onValueChange={(severity) =>
                          edit(rule.id)({ severity: severity as Severity })
                        }
                      />
                    ) : (
                      <span className="mnemonic text-xs">{rule.severity}</span>
                    )}
                  </TD>
                  <TD className="mnemonic text-xs">{rule.kind}</TD>
                  <TD className="num text-xs">{rule.metric}</TD>
                  <TD className="num">{rule.op}</TD>
                  {(['threshold', 'samples', 'clearRatio', 'windowSize'] as const).map((field) => (
                    <TD key={field} numeric className="overflow-visible">
                      <NumberCell
                        key={`${rule.id}-${field}-${rule[field]}`}
                        rule={rule}
                        field={field}
                        editable={canEdit}
                        onCommit={edit(rule.id)}
                      />
                    </TD>
                  ))}
                  <TD>
                    {canEdit ? (
                      <Switch
                        label={`${rule.id} enabled`}
                        checked={rule.enabled}
                        onCheckedChange={(enabled) => edit(rule.id)({ enabled })}
                      />
                    ) : (
                      <span className="mnemonic text-xs">{rule.enabled ? 'ON' : 'OFF'}</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Panel>
  );
}
