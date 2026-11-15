// Ctrl/Cmd+K command palette (cmdk): type-first jump to a satellite by name or NORAD id,
// navigate pages, toggle alert sound, start the guided tour, sign off.
import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSession } from '../auth/AuthContext.tsx';
import { NAV_ITEMS, hotkeyCaps } from '../nav.ts';
import { setSoundEnabled } from '../realtime/alertEffects.ts';
import { useAlertsStore } from '../realtime/alertsStore.ts';
import { useFleetStore } from '../realtime/fleetStore.ts';
import { Icon, Kbd, StatusChip } from '../ui/index.ts';
import { useCommandPalette } from './commandPaletteState.ts';
import { useResolveNavPath } from './NavRail.tsx';
import { useTour } from '../features/tour/tourContext.ts';

const ITEM =
  'mnemonic flex h-3 cursor-default items-center gap-1 px-1 text-xs text-text-2 data-[selected=true]:bg-grid data-[selected=true]:text-select';
const GROUP =
  '[&_[cmdk-group-heading]]:mnemonic [&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:py-0.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-text-dim';

export function CommandPalette() {
  const { isOpen, open } = useCommandPalette();
  useHotkeys('mod+k', () => open(!useCommandPalette.getState().isOpen), {
    preventDefault: true,
    enableOnFormTags: true,
  });
  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={open}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-bg/80"
      contentClassName="fixed top-[15%] left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 border border-select bg-panel"
    >
      {isOpen && <PaletteBody close={() => open(false)} />}
    </Command.Dialog>
  );
}

function PaletteBody({ close }: { close(): void }) {
  const navigate = useNavigate();
  const resolve = useResolveNavPath();
  const { can, logout } = useSession();
  const catalog = useFleetStore((s) => s.catalog);
  const status = useFleetStore((s) => s.status);
  const selectSat = useFleetStore((s) => s.selectSat);
  const soundEnabled = useAlertsStore((s) => s.soundEnabled);
  const { startTour } = useTour();

  const run = (action: () => void) => () => {
    close();
    action();
  };
  const satellites = Object.values(catalog).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="flex h-4 items-center gap-1 border-b border-rule px-1">
        <Icon name="search" size={14} className="text-text-dim" />
        <Command.Input
          autoFocus
          placeholder="SATELLITE NAME / NORAD ID / COMMAND"
          className="mnemonic h-full flex-1 bg-transparent text-sm text-text outline-hidden placeholder:text-text-dim"
        />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="max-h-[360px] overflow-y-auto">
        <Command.Empty className="mnemonic p-1 text-xs text-text-dim">NO MATCH</Command.Empty>
        <Command.Group heading="SATELLITES" className={GROUP}>
          {satellites.map((sat) => (
            <Command.Item
              key={sat.satId}
              value={`${sat.name} ${sat.satId}`}
              onSelect={run(() => {
                selectSat(sat.satId);
                navigate(`/sat/${sat.satId}`);
              })}
              className={ITEM}
            >
              <Icon name="satellite" size={14} />
              <span className="flex-1 truncate normal-case tracking-normal">{sat.name}</span>
              <span className="num text-text-dim">{sat.satId}</span>
              <StatusChip status={status[sat.satId] ?? 'NOM'} />
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="GO TO" className={GROUP}>
          {NAV_ITEMS.filter((item) => !item.minRole || can(item.minRole)).map((item) => (
            <Command.Item
              key={item.code}
              value={`${item.code} ${item.label}`}
              onSelect={run(() => navigate(resolve(item)))}
              className={ITEM}
            >
              <Icon name={item.icon} size={14} />
              <span className="w-6">{item.code}</span>
              <span className="flex-1 normal-case tracking-normal">{item.label}</span>
              {hotkeyCaps(item.hotkey).map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="ACTIONS" className={GROUP}>
          <Command.Item
            value="toggle alert sound mute"
            onSelect={run(() => setSoundEnabled(!soundEnabled))}
            className={ITEM}
          >
            <Icon name={soundEnabled ? 'speaker' : 'speaker-off'} size={14} />
            <span className="flex-1 normal-case tracking-normal">Alert sound</span>
            <span className="text-text-dim">{soundEnabled ? 'ON' : 'MUTED'}</span>
          </Command.Item>
          <Command.Item
            value="start guided tour onboarding help"
            onSelect={run(startTour)}
            className={ITEM}
          >
            <Icon name="orbit" size={14} />
            <span className="flex-1 normal-case tracking-normal">Start guided tour</span>
            <Kbd>Shift</Kbd>
            <Kbd>?</Kbd>
          </Command.Item>
          <Command.Item
            value="sign off logout"
            onSelect={run(() => void logout().then(() => navigate('/login', { replace: true })))}
            className={ITEM}
          >
            <Icon name="logout" size={14} />
            <span className="flex-1 normal-case tracking-normal">Sign off</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </>
  );
}
