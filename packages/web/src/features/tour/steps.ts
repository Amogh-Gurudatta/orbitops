// Onboarding tour content: the ordered step list for a role. Pure data and filtering, no React, so the
// order, routes and role gating are unit-tested. Viewers never see steps that point at controls they
// cannot use (commands, chaos); operators add the fault-injection step, admins add chaos on top.
import type { Role } from '@orbitops/shared';

/** The satellite the tour opens for the history step (the ISS is always in the catalogue). */
export const TOUR_SATELLITE_ID = 25544;

/** Values of the `data-tour` attribute that tour steps target. Keep in sync with the components. */
export const TOUR_TARGETS = {
  clocks: 'clocks',
  annunciators: 'annunciators',
  link: 'link',
  navRail: 'nav-rail',
  globe: 'panel-globe',
  fleetTable: 'panel-fleet',
  alarmLog: 'panel-alarms',
  pipeline: 'panel-pipeline',
  satHistory: 'sat-history',
  commands: 'sat-commands',
  chaos: 'chaos',
} as const;

export const tourSelector = (target: string): string => `[data-tour="${target}"]`;

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStep {
  id: string;
  /** Route the step lives on; the tour navigates here before showing it. */
  route: string;
  /** CSS selector of the element to spotlight, or null for a centred step with no target. */
  target: string | null;
  placement: TourPlacement;
  /** Mnemonic, shown in caps. */
  title: string;
  body: string;
}

interface StepDefinition extends Omit<TourStep, 'body'> {
  /** Lowest role that sees this step; omitted means everyone. */
  minRole?: Role;
  body: string | ((ctx: TourContext) => string);
}

export interface TourContext {
  role: Role;
  /** Satellites in the catalogue, for the welcome copy. */
  fleetSize: number;
}

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

export const roleAtLeast = (role: Role, minimum: Role): boolean => RANK[role] >= RANK[minimum];

const SAT_ROUTE = `/sat/${TOUR_SATELLITE_ID}`;

const DEFINITIONS: readonly StepDefinition[] = [
  {
    id: 'welcome',
    route: '/',
    target: null,
    placement: 'center',
    title: 'WELCOME TO ORBITOPS',
    body: ({ fleetSize }) =>
      `${fleetSize} satellites on real orbits, with live telemetry from each. The console is grey on purpose: colour only appears when something is abnormal.`,
  },
  {
    id: 'clocks',
    route: '/',
    target: TOUR_TARGETS.clocks,
    placement: 'bottom',
    title: 'MISSION CLOCKS',
    body: 'UTC is the shared clock for every timestamp. MET counts days, hours, minutes and seconds since the mission epoch.',
  },
  {
    id: 'annunciators',
    route: '/',
    target: TOUR_TARGETS.annunciators,
    placement: 'bottom',
    title: 'MASTER LAMPS AND ANNUNCIATORS',
    body: 'The WARNING and CAUTION lamps and the subsystem lamps light, and flash while an alarm is unacknowledged. Click a lamp to filter the alarm list.',
  },
  {
    id: 'link',
    route: '/',
    target: TOUR_TARGETS.link,
    placement: 'bottom',
    title: 'LINK STATUS',
    body: 'The badge reads LIVE, RECONNECTING or REPLAY. The readout beside it is the measured event-to-screen latency.',
  },
  {
    id: 'nav',
    route: '/',
    target: TOUR_TARGETS.navRail,
    placement: 'right',
    title: 'NAVIGATION',
    body: 'Each page has a three-letter code. Press g, then the page key, to jump: g f for the fleet, g s for a satellite, g a for alerts.',
  },
  {
    id: 'globe',
    route: '/',
    target: TOUR_TARGETS.globe,
    placement: 'right',
    title: 'GLOBE',
    body: 'Satellites move along real orbits, propagated in your browser. Click one to select it; a magenta line is a predicted track.',
  },
  {
    id: 'fleet-table',
    route: '/',
    target: TOUR_TARGETS.fleetTable,
    placement: 'left',
    title: 'FLEET TABLE',
    body: 'Sort by any column and filter the list. Use the arrow keys to move between rows and Enter to open a satellite.',
  },
  {
    id: 'alarm-log',
    route: '/',
    target: TOUR_TARGETS.alarmLog,
    placement: 'top',
    title: 'ALARM LOG',
    body: ({ role }) =>
      roleAtLeast(role, 'operator')
        ? 'Newest alarms first. Unacknowledged alarms flash; press ACK on a row to acknowledge it.'
        : 'Newest alarms first. Unacknowledged alarms flash until an operator acknowledges them.',
  },
  {
    id: 'pipeline',
    route: '/',
    target: TOUR_TARGETS.pipeline,
    placement: 'bottom',
    title: 'PIPELINE',
    body: 'Live ingest and broadcast rates, with counters for the duplicate, out-of-order and malformed events the server has defended against.',
  },
  {
    id: 'history',
    route: SAT_ROUTE,
    target: TOUR_TARGETS.satHistory,
    placement: 'bottom',
    title: 'HISTORY AND LIVE',
    body: 'Pick a range from five minutes to 24 hours. History from MongoDB joins the live stream at a watermark, so HIST, LIVE and DUP show no duplicated points.',
  },
  {
    id: 'commands',
    route: SAT_ROUTE,
    target: TOUR_TARGETS.commands,
    placement: 'top',
    minRole: 'operator',
    title: 'COMMANDS',
    body: 'Inject a fault (battery, thermal, tumble or comms) and watch alarms fire for this satellite. Clear the fault when you are done.',
  },
  {
    id: 'chaos',
    route: '/system',
    target: TOUR_TARGETS.chaos,
    placement: 'bottom',
    minRole: 'admin',
    title: 'CHAOS CONTROLS',
    body: 'Chaos mode makes the simulator send duplicate, out-of-order and malformed events. The counters climb while the charts stay clean.',
  },
  {
    id: 'finish',
    // Resolved to the route of the step before it, so finishing never navigates.
    route: '',
    target: null,
    placement: 'center',
    title: 'THAT IS THE TOUR',
    body: 'Press Ctrl+K to jump to any satellite or page. Press shift+? at any time to replay this tour.',
  },
];

/** The steps for a role, in order, with copy resolved and the closing step pinned to the last page. */
export function buildTourSteps(role: Role, fleetSize: number): TourStep[] {
  const ctx: TourContext = { role, fleetSize };
  const steps: TourStep[] = [];
  for (const { minRole, body, ...step } of DEFINITIONS) {
    if (minRole && !roleAtLeast(role, minRole)) continue;
    steps.push({
      ...step,
      route: step.route || steps[steps.length - 1]!.route,
      target: step.target === null ? null : tourSelector(step.target),
      body: typeof body === 'function' ? body(ctx) : body,
    });
  }
  return steps;
}

/** "STEP 03 / 11" for the tooltip header. */
export function stepCounter(index: number, total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `STEP ${pad(index + 1)} / ${pad(total)}`;
}
