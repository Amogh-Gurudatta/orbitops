import { describe, expect, it } from 'vitest';
import { SeqDeduplicator } from './dedup.js';

describe('SeqDeduplicator', () => {
  it('accepts new seqs and flags repeats', () => {
    const d = new SeqDeduplicator(16);
    expect(d.classify(0)).toBe('new');
    expect(d.classify(1)).toBe('new');
    expect(d.classify(1)).toBe('duplicate');
    expect(d.classify(0)).toBe('duplicate');
    expect(d.highWatermark).toBe(1);
  });

  it('accepts out-of-order seqs that have not been seen', () => {
    const d = new SeqDeduplicator(16);
    d.classify(5);
    expect(d.classify(3)).toBe('new');
    expect(d.classify(3)).toBe('duplicate');
  });

  it('treats seqs older than the window as duplicates', () => {
    const d = new SeqDeduplicator(8);
    d.classify(100);
    expect(d.classify(92)).toBe('new');
    expect(d.classify(91)).toBe('duplicate');
  });

  it('forgets everything on reset', () => {
    const d = new SeqDeduplicator(8);
    d.classify(10);
    d.reset();
    expect(d.classify(10)).toBe('new');
  });
});
