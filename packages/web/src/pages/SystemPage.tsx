// System / Performance: live pipeline health from the server's 1 Hz stats feed, the chaos switch
// and an explainer for the compact payload format.
import { SYSTEM_ROOM } from '@orbitops/shared';
import { ChaosPanel } from '../features/system/ChaosPanel.tsx';
import { PayloadPanel } from '../features/system/PayloadPanel.tsx';
import {
  BroadcastPanel,
  ClientsPanel,
  IngestPanel,
  LatencyPanel,
  RuntimePanel,
  StorePanel,
} from '../features/system/PipelinePanels.tsx';
import { usePipelineHistory } from '../features/system/usePipelineHistory.ts';
import { useSubscription } from '../realtime/useRealtime.ts';

export function Component() {
  useSubscription([SYSTEM_ROOM], 1);
  const { history, stats } = usePipelineHistory();
  const section = { history, stats };

  return (
    <div className="flex flex-col gap-1">
      <p className="mnemonic flex flex-wrap gap-x-2 text-xs text-text-dim">
        <span>SERVER STATS 1 HZ</span>
        <span>HISTORY 5 MIN</span>
        <span className="num">
          {stats
            ? `LAST SAMPLE ${new Date(stats.ts).toISOString().slice(11, 19)}Z`
            : 'WAITING FOR FIRST SAMPLE'}
        </span>
      </p>
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-12 [&>*]:min-h-[160px]">
        <div className="md:col-span-2 xl:col-span-8">
          <IngestPanel {...section} />
        </div>
        <div className="xl:col-span-4">
          <BroadcastPanel {...section} />
        </div>
        <div className="xl:col-span-4">
          <StorePanel {...section} />
        </div>
        <div className="xl:col-span-4">
          <RuntimePanel {...section} />
        </div>
        <div className="xl:col-span-4">
          <ClientsPanel {...section} />
        </div>
        <div className="xl:col-span-4">
          <LatencyPanel {...section} />
        </div>
        <div className="xl:col-span-4">
          <ChaosPanel history={history} />
        </div>
        <div className="xl:col-span-4">
          <PayloadPanel />
        </div>
      </div>
    </div>
  );
}
