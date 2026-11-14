// Visible proof that history and live data join without duplicates: once per second it reads the
// assembled trace the charts draw (history tier + live ring) and polls the worker's dedup counters.
import { useEffect, useState } from 'react';
import { realtime } from '../../realtime/client.ts';
import { telemetryStore } from '../../realtime/telemetryStore.ts';
import { analyzeSeam } from './seam.ts';

export interface SeamDiagnostics {
  /** Samples in the live ring buffer. */
  livePoints: number;
  /** Live events the worker dropped as duplicates or as already covered by history (session total). */
  dropped: number;
  /** Repeated or backwards timestamps in what is currently drawn; must stay 0. */
  renderedFaults: number;
}

const EMPTY: SeamDiagnostics = { livePoints: 0, dropped: 0, renderedFaults: 0 };

export function useSeamDiagnostics(satId: number): SeamDiagnostics {
  const [diag, setDiag] = useState(EMPTY);

  useEffect(() => {
    // A dedicated reader so diagnostics never disturb the charts' dirty tracking.
    const reader = telemetryStore.reader(satId, ['batSoc']);
    let cancelled = false;
    const sample = async () => {
      const stats = await realtime.stats();
      const data = reader.read(undefined, true);
      const report = data ? analyzeSeam(data.t) : null;
      const next: SeamDiagnostics = {
        livePoints: telemetryStore.snapshotFor(satId).ring?.length ?? 0,
        dropped: stats ? stats.duplicates + stats.belowWatermark : 0,
        renderedFaults: report ? report.duplicates + report.backwards : 0,
      };
      if (!cancelled) setDiag((prev) => (sameDiag(prev, next) ? prev : next));
    };
    void sample();
    const id = setInterval(() => void sample(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [satId]);

  return diag;
}

const sameDiag = (a: SeamDiagnostics, b: SeamDiagnostics) =>
  a.livePoints === b.livePoints && a.dropped === b.dropped && a.renderedFaults === b.renderedFaults;
