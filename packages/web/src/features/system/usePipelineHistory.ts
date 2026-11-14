// Records each 1 Hz PipelineStats push into a StatsHistory ring and re-renders the page once per sample.
import { useEffect, useRef, useState } from 'react';
import type { PipelineStats } from '../../api/types.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { StatsHistory } from './statsHistory.ts';

export function usePipelineHistory(): {
  history: StatsHistory;
  stats: PipelineStats | null;
} {
  const historyRef = useRef<StatsHistory>(null);
  historyRef.current ??= new StatsHistory();
  const history = historyRef.current;
  const [stats, setStats] = useState<PipelineStats | null>(() => {
    const current = useFleetStore.getState().pipeline;
    if (current) history.record(current);
    return current;
  });

  useEffect(
    () =>
      useFleetStore.subscribe((state, previous) => {
        if (
          state.pipeline &&
          state.pipeline !== previous.pipeline &&
          history.record(state.pipeline)
        )
          setStats(state.pipeline);
      }),
    [history],
  );

  return { history, stats };
}
