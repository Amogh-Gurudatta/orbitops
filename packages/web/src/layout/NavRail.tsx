// Left navigation rail: glyph over a three-letter mnemonic, with g-prefixed hotkeys.
import { NavLink, useNavigate } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSession } from '../auth/AuthContext.tsx';
import { NAV_ITEMS, hotkeyCaps, type NavItem } from '../nav.ts';
import { useFleetStore } from '../realtime/fleetStore.ts';
import { cx } from '../lib/cx.ts';
import { Icon, Kbd, Tooltip } from '../ui/index.ts';

/** SAT has no fixed path: it opens the selected satellite, else the first one in the catalogue. */
export function useResolveNavPath() {
  const selected = useFleetStore((s) => s.selectedSatId);
  const first = useFleetStore((s) => Object.keys(s.catalog)[0]);
  return (item: NavItem): string => {
    if (item.code !== 'SAT') return item.path;
    const target = selected ?? (first === undefined ? null : Number(first));
    return target === null ? '/' : `/sat/${target}`;
  };
}

function NavHotkey({ item }: { item: NavItem }) {
  const navigate = useNavigate();
  const resolve = useResolveNavPath();
  const { can } = useSession();
  useHotkeys(item.hotkey, () => navigate(resolve(item)), {
    enabled: !item.minRole || can(item.minRole),
  });
  return null;
}

export function NavRail() {
  const { can } = useSession();
  const resolve = useResolveNavPath();
  const items = NAV_ITEMS.filter((item) => !item.minRole || can(item.minRole));
  return (
    <nav
      aria-label="Primary"
      data-tour="nav-rail"
      className="flex w-(--nav-rail-w) shrink-0 flex-col border-r border-rule bg-panel"
    >
      {items.map((item) => (
        <NavHotkey key={item.code} item={item} />
      ))}
      {items.map((item) => (
        <Tooltip
          key={item.code}
          side="right"
          content={
            <span className="flex items-center gap-1">
              {item.label}
              {hotkeyCaps(item.hotkey).map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          }
        >
          {/* The trigger must be a plain element: Slot cannot merge NavLink's className function. */}
          <div>
            <NavLink
              to={resolve(item)}
              end={item.path === '/'}
              className={({ isActive }) =>
                cx(
                  'flex h-6 flex-col items-center justify-center gap-0.5 border-b border-grid',
                  isActive
                    ? 'bg-bg text-select outline outline-1 -outline-offset-1 outline-select'
                    : 'text-text-2 hover:text-text',
                )
              }
            >
              <Icon name={item.icon} size={16} />
              <span className="mnemonic text-xs">{item.code}</span>
            </NavLink>
          </div>
        </Tooltip>
      ))}
    </nav>
  );
}
