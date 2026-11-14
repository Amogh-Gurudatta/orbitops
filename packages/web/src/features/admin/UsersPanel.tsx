// USERS: account table with role changes, plus the create-user form.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES, type Role } from '@orbitops/shared';
import { useSession } from '../../auth/AuthContext.tsx';
import { formatUtcDateTime } from '../../lib/formatTime.ts';
import {
  Button,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Panel,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Tooltip,
  TR,
} from '../../ui/index.ts';
import { adminKeys, createUser, describeError, fetchUsers, updateUserRole } from './adminApi.ts';
import { objectIdTime, validateCreateUser, type FieldErrors } from './forms.ts';

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: r.toUpperCase() }));
const EMPTY = { email: '', name: '', password: '', role: 'viewer' as Role };

export function UsersPanel() {
  const { user: me } = useSession();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: adminKeys.users, queryFn: fetchUsers });
  const [form, setForm] = useState<{ email: string; name: string; password: string; role: string }>(
    EMPTY,
  );
  const [errors, setErrors] = useState<FieldErrors<keyof typeof EMPTY>>({});

  const refresh = () => void queryClient.invalidateQueries({ queryKey: adminKeys.users });
  const roleChange = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => updateUserRole(id, role),
    onSettled: refresh,
  });
  const create = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setForm(EMPTY);
      setErrors({});
      refresh();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateCreateUser(form);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.value);
  };
  const set = (field: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <Panel title="USERS" subtitle="OPERATOR ACCOUNTS" flush bodyClassName="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {users.isPending ? (
          <LoadingState label="LOADING USERS" />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>EMAIL</TH>
                <TH>NAME</TH>
                <TH>ROLE</TH>
                <TH>CREATED (UTC)</TH>
              </TR>
            </THead>
            <TBody>
              {users.data.map((u) => {
                const self = u.id === me?.id;
                const created = objectIdTime(u.id);
                return (
                  <TR key={u.id}>
                    <TD className="num text-xs">
                      {u.email} {self && <span className="mnemonic text-text-dim">YOU</span>}
                    </TD>
                    <TD>{u.name}</TD>
                    <TD className="overflow-visible">
                      {self ? (
                        <Tooltip content="YOU CANNOT CHANGE YOUR OWN ROLE">
                          <span tabIndex={0} className="mnemonic text-xs text-text-2">
                            {u.role.toUpperCase()} · LOCKED
                          </span>
                        </Tooltip>
                      ) : (
                        <Select
                          aria-label={`Role for ${u.email}`}
                          value={u.role}
                          options={ROLE_OPTIONS}
                          className="h-[22px] w-28"
                          onValueChange={(role) =>
                            roleChange.mutate({ id: u.id, role: role as Role })
                          }
                        />
                      )}
                    </TD>
                    <TD className="num text-xs text-text-2">
                      {created ? formatUtcDateTime(created) : '—'}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
      {roleChange.isError && (
        <p role="alert" className="mnemonic border-t border-rule px-1 py-0.5 text-xs text-warning">
          ROLE NOT CHANGED — {describeError(roleChange.error)}
        </p>
      )}

      <form onSubmit={submit} noValidate className="shrink-0 border-t border-rule p-1">
        <h3 className="mnemonic pb-1 text-xs text-text-2">CREATE USER</h3>
        <div className="grid grid-cols-1 gap-x-1 gap-y-1 sm:grid-cols-2">
          <Field label="EMAIL" error={errors.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={set('email')}
              />
            )}
          </Field>
          <Field label="NAME" error={errors.name}>
            {(id) => <Input id={id} autoComplete="off" value={form.name} onChange={set('name')} />}
          </Field>
          <Field label="PASSWORD" error={errors.password} hint="At least 8 characters">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={set('password')}
              />
            )}
          </Field>
          <Field label="ROLE" error={errors.role}>
            {(id) => (
              <Select
                id={id}
                value={form.role}
                options={ROLE_OPTIONS}
                className="w-full"
                onValueChange={(role) => setForm((f) => ({ ...f, role }))}
              />
            )}
          </Field>
        </div>
        <div className="flex items-center gap-1 pt-1">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'CREATING…' : 'CREATE USER'}
          </Button>
          {create.isError && (
            <span role="alert" className="mnemonic text-xs text-warning">
              {describeError(create.error)}
            </span>
          )}
          {create.isSuccess && <span className="mnemonic text-xs text-text-2">USER CREATED</span>}
        </div>
      </form>
    </Panel>
  );
}
