import { describe, expect, it } from 'vitest';
import { chunkSpan } from './replayApi.ts';

const H = 3_600_000;

describe('chunkSpan', () => {
  it('splits a 6 h window into three 2 h chunks with shared edges', () => {
    expect(chunkSpan({ from: 0, to: 6 * H })).toEqual([
      { from: 0, to: 2 * H },
      { from: 2 * H, to: 4 * H },
      { from: 4 * H, to: 6 * H },
    ]);
  });
  it('keeps every chunk within the raw limit, shortening the last', () => {
    const chunks = chunkSpan({ from: 0, to: 5 * H });
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.to - c.from <= 2 * H)).toBe(true);
    expect(chunks[2]).toEqual({ from: 4 * H, to: 5 * H });
  });
});
