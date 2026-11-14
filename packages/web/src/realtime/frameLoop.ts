// One requestAnimationFrame loop for the whole app. Panels register a callback with an optional
// rate cap; the loop runs only while something is registered. Callbacks check their own dirty flag
// (store version) and redraw only when data changed, which batches all rendering into one frame.

export type FrameCallback = (now: number) => void;

export interface FrameOptions {
  /** Maximum calls per second for this callback. Defaults to every frame. */
  hz?: number;
}

interface Entry {
  cb: FrameCallback;
  minIntervalMs: number;
  lastRun: number;
}

/** 60 Hz frames land at 16.7 ms steps; this tolerance keeps a 10 Hz cap from drifting to 8 Hz. */
const FRAME_TOLERANCE_MS = 4;

export interface FrameLoop {
  onFrame(cb: FrameCallback, options?: FrameOptions): () => void;
}

export function createFrameLoop(
  request: (cb: FrameRequestCallback) => number,
  cancel: (id: number) => void,
): FrameLoop {
  const entries = new Set<Entry>();
  let handle: number | null = null;

  const tick: FrameRequestCallback = (now) => {
    handle = null;
    for (const entry of [...entries]) {
      if (now - entry.lastRun < entry.minIntervalMs - FRAME_TOLERANCE_MS) continue;
      entry.lastRun = now;
      entry.cb(now);
    }
    if (entries.size > 0) handle = request(tick);
  };

  return {
    onFrame(cb, options = {}) {
      const entry: Entry = {
        cb,
        minIntervalMs: options.hz ? 1000 / options.hz : 0,
        lastRun: -Infinity,
      };
      entries.add(entry);
      if (handle === null) handle = request(tick);
      return () => {
        entries.delete(entry);
        if (entries.size === 0 && handle !== null) {
          cancel(handle);
          handle = null;
        }
      };
    },
  };
}

const loop = createFrameLoop(
  (cb) => requestAnimationFrame(cb),
  (id) => cancelAnimationFrame(id),
);

/** Registers a per-frame callback on the shared loop; returns the unregister function. */
export const onFrame: FrameLoop['onFrame'] = (cb, options) => loop.onFrame(cb, options);
