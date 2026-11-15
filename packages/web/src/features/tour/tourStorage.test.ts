import { describe, expect, it } from 'vitest';
import { createTourStorage, tourStorageKey } from './tourStorage.ts';

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const blocked = () => {
  throw new DOMException('denied', 'SecurityError');
};

describe('tourStorageKey', () => {
  it('is versioned and per user', () => {
    expect(tourStorageKey('u1')).toBe('orbitops.tour.v1.u1');
    expect(tourStorageKey('u1')).not.toBe(tourStorageKey('u2'));
  });
});

describe('createTourStorage', () => {
  it('reports a first run until an outcome is written', () => {
    const backing = fakeStorage();
    const storage = createTourStorage(() => backing);
    expect(storage.read('u1')).toBeNull();
    storage.write('u1', 'finished');
    expect(storage.read('u1')).toBe('finished');
    expect(backing.data.get('orbitops.tour.v1.u1')).toBe('finished');
  });

  it('remembers skipped separately from finished', () => {
    const storage = createTourStorage(() => fakeStorage());
    storage.write('u1', 'skipped');
    expect(storage.read('u1')).toBe('skipped');
  });

  it('tracks users independently', () => {
    const storage = createTourStorage(() => fakeStorage());
    storage.write('u1', 'finished');
    expect(storage.read('u2')).toBeNull();
  });

  it('ignores a record written under an older version of the key', () => {
    const backing = fakeStorage();
    backing.data.set('orbitops.tour.v0.u1', 'finished');
    expect(createTourStorage(() => backing).read('u1')).toBeNull();
  });

  it('ignores unrecognised stored values', () => {
    const backing = fakeStorage();
    backing.data.set(tourStorageKey('u1'), 'garbage');
    expect(createTourStorage(() => backing).read('u1')).toBeNull();
  });

  it('falls back to memory when storage throws, so the tour does not repeat in one session', () => {
    const storage = createTourStorage(blocked);
    expect(storage.read('u1')).toBeNull();
    expect(() => storage.write('u1', 'skipped')).not.toThrow();
    expect(storage.read('u1')).toBe('skipped');
  });

  it('falls back when only writes are rejected (quota exceeded)', () => {
    const backing = {
      getItem: () => null,
      setItem: blocked,
    };
    const storage = createTourStorage(() => backing);
    storage.write('u1', 'finished');
    expect(storage.read('u1')).toBe('finished');
  });
});
