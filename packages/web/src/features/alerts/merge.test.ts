import { describe, expect, it } from 'vitest';
import { makeAlert } from './alertFixtures.ts';
import { DEFAULT_FILTERS } from './filters.ts';
import { mergeAlerts } from './merge.ts';

describe('mergeAlerts', () => {
  it('dedupes by id and lets the live row replace the REST row', () => {
    const rest = [makeAlert({ id: 'a', state: 'open', openedAt: 10 })];
    const live = [makeAlert({ id: 'a', state: 'acked', openedAt: 10, ackedBy: 'op' })];
    const merged = mergeAlerts(rest, live, DEFAULT_FILTERS);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.state).toBe('acked');
  });

  it('adds live alerts that REST has not seen and sorts newest-opened first', () => {
    const rest = [makeAlert({ id: 'old', openedAt: 10 })];
    const live = [makeAlert({ id: 'new', openedAt: 30 }), makeAlert({ id: 'mid', openedAt: 20 })];
    expect(mergeAlerts(rest, live, DEFAULT_FILTERS).map((a) => a.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('drops a row that a live update moved out of the active filter', () => {
    const rest = [makeAlert({ id: 'a', state: 'open' })];
    const live = [makeAlert({ id: 'a', state: 'acked' })];
    expect(mergeAlerts(rest, live, { ...DEFAULT_FILTERS, state: 'open' })).toEqual([]);
  });

  it('filters live-only rows by every filter dimension', () => {
    const live = [
      makeAlert({ id: 'x', subsystem: 'EPS' }),
      makeAlert({ id: 'y', subsystem: 'TCS' }),
    ];
    const merged = mergeAlerts([], live, { ...DEFAULT_FILTERS, subsystem: 'EPS' });
    expect(merged.map((a) => a.id)).toEqual(['x']);
  });
});
