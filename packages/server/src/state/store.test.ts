import { describe, expect, it } from 'vitest';
import { FIELD_KEYS } from '@orbitops/shared';
import { frame } from '../testing/factories.js';
import { StateStore } from './store.js';

const store = () => new StateStore(() => 'weather');

describe('StateStore', () => {
  it('marks every field dirty on the first sample and drains a full delta', () => {
    const s = store();
    s.apply(1, 1, 1000, frame());
    const [delta] = s.drainDirty();
    expect(delta).toMatchObject({ s: 1, q: 1, t: 1000 });
    expect(Object.keys(delta?.d ?? {})).toHaveLength(Object.keys(FIELD_KEYS).length);
    expect(s.drainDirty()).toEqual([]);
  });

  it('only reports fields that changed after rounding', () => {
    const s = store();
    s.apply(1, 1, 1000, frame({ batSoc: 0.9, panelTempC: 30 }));
    s.drainDirty();
    // 0.9001 rounds to the same 3-decimal value; 31 does not.
    s.apply(1, 2, 1100, frame({ batSoc: 0.9001, panelTempC: 31 }));
    const [delta] = s.drainDirty();
    expect(delta?.d).toEqual({ [FIELD_KEYS.panelTempC]: 31 });
    expect(delta?.q).toBe(2);
  });

  it('accumulates changes across samples between drains', () => {
    const s = store();
    s.apply(1, 1, 1000, frame());
    s.drainDirty();
    s.apply(1, 2, 1100, frame({ panelTempC: 40 }));
    s.apply(1, 3, 1200, frame({ panelTempC: 40, obcTempC: 50 }));
    const [delta] = s.drainDirty();
    expect(Object.keys(delta?.d ?? {}).sort()).toEqual(
      [FIELD_KEYS.obcTempC, FIELD_KEYS.panelTempC].sort(),
    );
    expect(delta?.q).toBe(3);
  });

  it('produces full snapshots and filters by satellite', () => {
    const s = store();
    s.apply(1, 7, 1000, frame());
    s.apply(2, 9, 1000, frame());
    expect(s.snapshot(1)?.q).toBe(7);
    expect(Object.keys(s.snapshot(1)?.d ?? {})).toHaveLength(Object.keys(FIELD_KEYS).length);
    expect(s.snapshots([2]).map((x) => x.s)).toEqual([2]);
    expect(s.snapshots()).toHaveLength(2);
    expect(s.snapshot(3)).toBeUndefined();
  });

  it('tracks staleness and groups', () => {
    const s = store();
    s.apply(1, 1, 1000, frame(), 5_000);
    s.apply(2, 1, 1000, frame(), 9_000);
    expect(s.lastSeenAt(1)).toBe(5_000);
    expect(s.staleSatIds(10_000, 3_000)).toEqual([1]);
    expect(s.satIdsInGroup('weather').sort()).toEqual([1, 2]);
    expect(s.group(1)).toBe('weather');
  });
});
