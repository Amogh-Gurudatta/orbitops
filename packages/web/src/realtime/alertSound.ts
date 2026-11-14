// Optional WebAudio alert tones, generated with oscillators (no audio assets).
// WARNING = repeating two-tone while any warning is unacknowledged; CAUTION = single chime.
// Muted by default; enabling happens from a user gesture so the AudioContext may start.
import type { Severity } from '@orbitops/shared';

const WARNING_REPEAT_MS = 3000;

class AlertSound {
  private ctx: AudioContext | null = null;
  private enabled = false;
  private repeat: ReturnType<typeof setInterval> | null = null;

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } else this.stopRepeat();
  }

  /** Plays the cue for a newly raised alert. */
  announce(severity: Severity): void {
    if (!this.enabled) return;
    if (severity === 'WARNING') this.twoTone();
    else if (severity === 'CAUTION') this.tone(523, 0, 0.28);
  }

  /** Keeps the warning two-tone repeating while unacknowledged warnings exist. */
  syncUnackedWarnings(count: number): void {
    if (this.enabled && count > 0) {
      this.repeat ??= setInterval(() => this.twoTone(), WARNING_REPEAT_MS);
    } else this.stopRepeat();
  }

  private stopRepeat(): void {
    if (this.repeat) clearInterval(this.repeat);
    this.repeat = null;
  }

  private twoTone(): void {
    this.tone(880, 0, 0.16);
    this.tone(660, 0.18, 0.16);
  }

  private tone(freq: number, offsetS: number, durationS: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + offsetS;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.06, start + 0.01);
    gain.gain.setValueAtTime(0.06, start + durationS - 0.02);
    gain.gain.linearRampToValueAtTime(0.0001, start + durationS);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationS);
  }
}

export const alertSound = new AlertSound();
