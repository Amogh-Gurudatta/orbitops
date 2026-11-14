// Transport bar under the timeline: step, play/pause, speed, and the LIVE exit.
import { Button, Icon, Kbd, SegmentedControl } from '../../ui/index.ts';
import { SPEEDS, type Speed } from './timeline.ts';
import type { Playback } from './usePlayback.ts';

const SPEED_OPTIONS = SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));

export function Transport({
  playback,
  offsetLabel,
  onLive,
}: {
  playback: Playback;
  /** "T−12:30" distance of the playhead from the end of the window. */
  offsetLabel: string;
  onLive(): void;
}) {
  const { playing, speed, toggle, setSpeed, step } = playback;
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-rule px-1 py-0.5">
      <Button size="sm" aria-label="Back 10 minutes" onClick={() => step(-600_000)}>
        −10M
      </Button>
      <Button
        size="sm"
        variant="primary"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={toggle}
        className="min-w-[72px]"
      >
        <Icon name={playing ? 'pause' : 'play'} size={12} />
        {playing ? 'PAUSE' : 'PLAY'}
      </Button>
      <Button size="sm" aria-label="Forward 10 minutes" onClick={() => step(600_000)}>
        +10M
      </Button>
      <span className="mnemonic ml-1 text-xs text-text-dim">SPEED</span>
      <SegmentedControl
        aria-label="Playback speed"
        value={String(speed)}
        onValueChange={(v) => setSpeed(Number(v) as Speed)}
        options={SPEED_OPTIONS}
      />
      <span className="num ml-1 text-xs text-text-2">{offsetLabel}</span>
      <span className="flex-1" />
      <span className="hidden items-center gap-0.5 text-2xs text-text-dim md:flex">
        <Kbd>Space</Kbd> PLAY
        <Kbd>←</Kbd>
        <Kbd>→</Kbd> 1 MIN
      </span>
      <Button size="sm" onClick={onLive} aria-label="Exit replay and return to live">
        LIVE
      </Button>
    </div>
  );
}
