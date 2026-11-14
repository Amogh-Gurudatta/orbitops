// Console sign-on screen. Left: system identity and the colour legend (what the console's colours
// mean). Right: credentials form with three one-click demo roles. Uses React 19 useActionState.
import { useActionState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { SUBSYSTEMS } from '@orbitops/shared';
import { ApiError } from '../api/client.ts';
import { useSession } from '../auth/AuthContext.tsx';
import { MissionClocks } from '../layout/MissionClocks.tsx';
import { Button, Field, Icon, Input, Lamp, StatusChip, Tag } from '../ui/index.ts';

const DEMO_PASSWORD = 'orbitops';
const DEMO_ACCOUNTS = [
  { role: 'viewer', email: 'viewer@orbitops.dev', scope: 'READ-ONLY' },
  { role: 'operator', email: 'operator@orbitops.dev', scope: 'ACK / COMMAND' },
  { role: 'admin', email: 'admin@orbitops.dev', scope: 'FULL ACCESS' },
] as const;

const SUBSYSTEM_NAMES: Record<(typeof SUBSYSTEMS)[number], string> = {
  EPS: 'Electrical power',
  TCS: 'Thermal control',
  COMM: 'Communications',
  ADCS: 'Attitude determination and control',
  PROP: 'Propulsion',
  OBC: 'On-board computer',
};

interface SignOnState {
  error: string | null;
  email: string;
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'ACCESS DENIED // INVALID CREDENTIALS';
    if (error.status === 429) {
      const wait = error.retryAfter ? ` // RETRY IN ${error.retryAfter}S` : '';
      return `RATE LIMITED // TOO MANY SIGN-ON ATTEMPTS${wait}`;
    }
    return `LINK FAULT // ${error.message.toUpperCase()}`;
  }
  return 'LINK FAULT // SERVER UNREACHABLE';
}

export function Component() {
  const session = useSession();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [state, signOn, pending] = useActionState<SignOnState, FormData>(
    async (_previous, formData) => {
      const demo = DEMO_ACCOUNTS.find((a) => a.role === formData.get('demo'));
      const email = demo?.email ?? String(formData.get('email') ?? '').trim();
      const password = demo ? DEMO_PASSWORD : String(formData.get('password') ?? '');
      try {
        await session.login(email, password);
        return { error: null, email };
      } catch (error) {
        return { error: describeFailure(error), email };
      }
    },
    { error: null, email: '' },
  );

  if (session.status === 'authenticated') return <Navigate to={from} replace />;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="mnemonic flex h-3 shrink-0 items-center justify-center bg-text text-xs text-bg">
        UNCLASSIFIED // DEMO
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_minmax(380px,480px)]">
        <section
          className="flex flex-col gap-3 border-rule p-3 lg:border-r"
          aria-label="System status"
        >
          <header className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-select">
              <Icon name="orbit" size={24} />
              <h1 className="mnemonic text-xl tracking-[0.18em]">ORBITOPS</h1>
            </div>
            <p className="mnemonic text-sm text-text-2">
              MISSION CONTROL // SATELLITE FLEET TELEMETRY
            </p>
            <p className="mnemonic text-xs text-text-dim">
              REL 0.1.0 // CLASS DEMO // SINGLE ORIGIN
            </p>
          </header>

          <p className="max-w-[56ch] text-sm leading-[20px] text-text-2">
            Live monitoring of a 65-spacecraft fleet. Orbits are propagated from real two-line
            elements; telemetry is simulated, streamed at up to 10 Hz, deduplicated and persisted,
            and checked by an anomaly engine that raises alerts per subsystem.
          </p>

          <section aria-labelledby="legend" className="flex flex-col">
            <h2 id="legend" className="mnemonic border-b border-rule pb-0.5 text-xs text-text-dim">
              DISPLAY LEGEND // COLOUR MEANS ABNORMAL
            </h2>
            <LegendRow
              chip={<StatusChip status="NOM" />}
              text="Nominal. Grey is normal: no colour, no attention needed."
            />
            <LegendRow
              chip={<StatusChip status="CAUT" />}
              text="Caution. Amber. Developing condition; act before it degrades."
            />
            <LegendRow
              chip={<StatusChip status="WARN" />}
              text="Warning. Red. Immediate attention. Flashes until acknowledged."
            />
            <LegendRow
              chip={<StatusChip status="STALE" />}
              text="No data. Hatched. The last value is not trustworthy."
            />
            <LegendRow
              chip={<Tag tone="predicted">PRED</Tag>}
              text="Predicted or commanded. Magenta. Orbits, planned passes."
            />
          </section>

          <section aria-labelledby="subsystems" className="flex flex-col">
            <h2
              id="subsystems"
              className="mnemonic border-b border-rule pb-0.5 text-xs text-text-dim"
            >
              SUBSYSTEM ANNUNCIATORS
            </h2>
            <ul className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              {SUBSYSTEMS.map((name) => (
                <li key={name} className="flex h-3 items-center gap-1 border-b border-grid">
                  <Lamp label={name} className="w-6" />
                  <span className="text-xs text-text-2">{SUBSYSTEM_NAMES[name]}</span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="mt-auto flex items-center gap-2 border-t border-rule pt-1">
            <MissionClocks />
          </footer>
        </section>

        <section className="flex flex-col gap-3 p-3" aria-label="Sign on">
          <form action={signOn} className="flex flex-col gap-2" noValidate={false}>
            <h2 className="mnemonic text-sm text-text-2">SIGN ON</h2>
            <Field label="OPERATOR ID (EMAIL)">
              {(id) => (
                <Input
                  id={id}
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  defaultValue={state.email}
                />
              )}
            </Field>
            <Field label="PASSPHRASE">
              {(id) => (
                <Input
                  id={id}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>
            {state.error && (
              <p role="alert" className="mnemonic border border-warning p-1 text-xs text-warning">
                {state.error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'AUTHENTICATING…' : 'SIGN ON'}
            </Button>

            <div className="mt-2 flex flex-col gap-1 border-t border-rule pt-2">
              <h3 className="mnemonic text-xs text-text-dim">QUICK SIGN-ON // DEMO ACCOUNTS</h3>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.role}
                  type="submit"
                  name="demo"
                  value={account.role}
                  formNoValidate
                  disabled={pending}
                  className="mnemonic flex h-4 items-center justify-between border border-rule px-1 text-xs text-text hover:border-select disabled:text-text-dim"
                >
                  <span>{account.role.toUpperCase()}</span>
                  <span className="text-text-dim">{account.scope}</span>
                </button>
              ))}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

function LegendRow({ chip, text }: { chip: React.ReactNode; text: string }) {
  return (
    <div className="flex h-3 items-center gap-1 border-b border-grid">
      <span className="w-6 shrink-0">{chip}</span>
      <span className="text-xs text-text-2">{text}</span>
    </div>
  );
}
