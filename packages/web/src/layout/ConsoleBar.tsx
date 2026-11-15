// Top console bar: product mark, mission clocks, master + subsystem annunciators, link status, user.
import { Link } from 'react-router';
import { useCommandPalette } from './commandPaletteState.ts';
import { ConnectionBadge, Icon, Kbd, Tooltip } from '../ui/index.ts';
import { useConnection } from '../realtime/useRealtime.ts';
import { useFleetStore } from '../realtime/fleetStore.ts';
import { MasterLamps, SubsystemStrip } from './Annunciators.tsx';
import { MissionClocks } from './MissionClocks.tsx';
import { UserMenu } from './UserMenu.tsx';

function LatencyReadout() {
  const p95 = useFleetStore((s) => s.latency?.p95);
  if (p95 === undefined) return null;
  return (
    <Tooltip content="Event-to-screen latency, 95th percentile">
      <span className="num hidden text-xs text-text-dim xl:inline">
        <span className="mnemonic mr-0.5">LAT P95</span>
        {p95.toFixed(0)}
        <span className="ml-0.5 text-2xs">ms</span>
      </span>
    </Tooltip>
  );
}

export function ConsoleBar() {
  const connection = useConnection();
  const openPalette = useCommandPalette((s) => s.open);
  return (
    <header className="flex h-(--console-bar-h) shrink-0 items-center gap-2 border-b border-rule bg-panel px-1">
      <Link
        to="/"
        className="flex items-center gap-1 pr-1 text-select"
        aria-label="OrbitOps fleet overview"
      >
        <Icon name="orbit" size={20} />
        <span className="mnemonic text-lg tracking-[0.18em]">ORBITOPS</span>
      </Link>
      <span className="h-3 border-l border-rule" aria-hidden="true" />
      <div className="hidden md:block" data-tour="clocks">
        <MissionClocks />
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2" data-tour="annunciators">
        <MasterLamps />
        <div className="hidden lg:block">
          <SubsystemStrip />
        </div>
      </div>
      <span className="h-3 border-l border-rule" aria-hidden="true" />
      <div className="flex items-center gap-2" data-tour="link">
        <LatencyReadout />
        <ConnectionBadge label={connection.label} />
      </div>
      <button
        type="button"
        onClick={() => openPalette(true)}
        className="mnemonic hidden h-3 items-center gap-1 border border-rule px-1 text-xs text-text-2 hover:border-text-2 sm:flex"
        aria-label="Open command palette"
      >
        <Icon name="search" size={14} />
        <span>JUMP</span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>
      <UserMenu />
    </header>
  );
}
