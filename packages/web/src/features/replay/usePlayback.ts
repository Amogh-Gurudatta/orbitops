// Playhead clock for replay. The playhead lives in a ref advanced on the shared frame loop; React
// state is published at 15 Hz so the timeline, globe and charts follow without re-rendering per frame.
import { useCallback, useEffect, useRef, useState } from 'react';
import { onFrame } from '../../realtime/frameLoop.ts';
import { advancePlayhead, clampTime, stepTime, type Speed, type TimeSpan } from './timeline.ts';

const PUBLISH_HZ = 15;
/** A long frame (background tab) must not teleport the playhead. */
const MAX_FRAME_DT_MS = 250;

export interface Playback {
  timeMs: number;
  playing: boolean;
  speed: Speed;
  toggle(): void;
  setSpeed(speed: Speed): void;
  seek(t: number): void;
  step(deltaMs: number): void;
}

export function usePlayback(span: TimeSpan, initialMs: number, initialSpeed: Speed = 60): Playback {
  const [timeMs, setTimeMs] = useState(initialMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(initialSpeed);
  const clock = useRef({
    t: initialMs,
    playing: false,
    speed: initialSpeed,
    last: null as number | null,
  });

  useEffect(() => {
    clock.current.speed = speed;
  }, [speed]);

  useEffect(
    () =>
      onFrame(
        (now) => {
          const c = clock.current;
          if (!c.playing) {
            c.last = null;
            return;
          }
          const dt = c.last === null ? 0 : Math.min(now - c.last, MAX_FRAME_DT_MS);
          c.last = now;
          const next = advancePlayhead(c.t, dt, c.speed, span);
          c.t = next.t;
          if (next.ended) {
            c.playing = false;
            setPlaying(false);
          }
          setTimeMs(next.t);
        },
        { hz: PUBLISH_HZ },
      ),
    [span],
  );

  const seek = useCallback(
    (t: number) => {
      clock.current.t = clampTime(t, span);
      setTimeMs(clock.current.t);
    },
    [span],
  );

  const toggle = useCallback(() => {
    const c = clock.current;
    // Replaying from the very end restarts a few minutes earlier rather than doing nothing.
    if (!c.playing && c.t >= span.to) c.t = Math.max(span.from, span.to - 10 * 60_000);
    c.playing = !c.playing;
    c.last = null;
    setPlaying(c.playing);
    setTimeMs(c.t);
  }, [span]);

  const step = useCallback(
    (deltaMs: number) => seek(stepTime(clock.current.t, deltaMs, span)),
    [seek, span],
  );

  return { timeMs, playing, speed, toggle, setSpeed, seek, step };
}
