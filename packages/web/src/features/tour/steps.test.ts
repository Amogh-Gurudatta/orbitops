import { describe, expect, it } from 'vitest';
import { buildTourSteps, stepCounter, TOUR_SATELLITE_ID } from './steps.ts';

const ids = (role: Parameters<typeof buildTourSteps>[0]) =>
  buildTourSteps(role, 64).map((s) => s.id);

describe('buildTourSteps role filtering', () => {
  it('gives viewers the core tour only', () => {
    const viewer = ids('viewer');
    expect(viewer).not.toContain('commands');
    expect(viewer).not.toContain('chaos');
    expect(viewer).toHaveLength(11);
  });

  it('adds fault injection for operators but not chaos', () => {
    const operator = ids('operator');
    expect(operator).toContain('commands');
    expect(operator).not.toContain('chaos');
    expect(operator).toHaveLength(12);
  });

  it('gives admins every step', () => {
    expect(ids('admin')).toEqual([
      'welcome',
      'clocks',
      'annunciators',
      'link',
      'nav',
      'globe',
      'fleet-table',
      'alarm-log',
      'pipeline',
      'history',
      'commands',
      'chaos',
      'finish',
    ]);
  });

  it('keeps the shared steps in the same order for every role', () => {
    const core = ids('viewer');
    for (const role of ['operator', 'admin'] as const) {
      expect(ids(role).filter((id) => core.includes(id))).toEqual(core);
    }
  });
});

describe('buildTourSteps routes and targets', () => {
  const admin = buildTourSteps('admin', 64);
  const byId = (id: string) => admin.find((s) => s.id === id)!;

  it('visits the fleet page, then the satellite page, then system', () => {
    expect(byId('welcome').route).toBe('/');
    expect(byId('pipeline').route).toBe('/');
    expect(byId('history').route).toBe(`/sat/${TOUR_SATELLITE_ID}`);
    expect(byId('commands').route).toBe(`/sat/${TOUR_SATELLITE_ID}`);
    expect(byId('chaos').route).toBe('/system');
  });

  it('never goes back to an earlier route (so Back is the only way home)', () => {
    const routes = admin.map((s) => s.route);
    const firstSeen = [...new Set(routes)];
    expect(routes).toEqual([...routes].sort((a, b) => firstSeen.indexOf(a) - firstSeen.indexOf(b)));
  });

  it('pins the closing step to the last page so finishing never navigates', () => {
    for (const role of ['viewer', 'operator', 'admin'] as const) {
      const steps = buildTourSteps(role, 64);
      expect(steps.at(-1)!.route).toBe(steps.at(-2)!.route);
    }
  });

  it('centres the welcome and finish steps without a target', () => {
    for (const id of ['welcome', 'finish']) {
      expect(byId(id)).toMatchObject({ target: null, placement: 'center' });
    }
  });

  it('targets data-tour attributes, never class names', () => {
    for (const step of admin) {
      if (step.target !== null) expect(step.target).toMatch(/^\[data-tour="[a-z-]+"\]$/);
    }
  });
});

describe('buildTourSteps copy', () => {
  it('uses the real fleet size in the welcome step', () => {
    expect(buildTourSteps('viewer', 64)[0]!.body).toContain('64 satellites');
  });

  it('only tells operators and above to press ACK', () => {
    const ack = (role: Parameters<typeof buildTourSteps>[0]) =>
      buildTourSteps(role, 64).find((s) => s.id === 'alarm-log')!.body;
    expect(ack('viewer')).not.toContain('ACK');
    expect(ack('operator')).toContain('ACK');
    expect(ack('admin')).toContain('ACK');
  });

  it('keeps every step to one or two sentences', () => {
    for (const step of buildTourSteps('admin', 64)) {
      const sentences = step.body.split(/(?<=[.!])\s+/);
      expect(sentences.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('stepCounter', () => {
  it('zero-pads the one-based position', () => {
    expect(stepCounter(2, 11)).toBe('STEP 03 / 11');
    expect(stepCounter(0, 13)).toBe('STEP 01 / 13');
  });
});
