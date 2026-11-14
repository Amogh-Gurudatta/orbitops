// Navigation model shared by the nav rail, hotkeys and command palette.
import type { Role } from '@orbitops/shared';
import type { IconName } from './ui/icons.tsx';

export interface NavItem {
  /** Three-letter mnemonic shown in the rail. */
  code: string;
  label: string;
  /** Route path. SAT is resolved at navigation time (needs a satellite id). */
  path: string;
  icon: IconName;
  /** react-hotkeys-hook sequence (">" separates keys). */
  hotkey: string;
  minRole?: Role;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { code: 'FLT', label: 'Fleet overview', path: '/', icon: 'globe', hotkey: 'g>f' },
  { code: 'SAT', label: 'Satellite detail', path: '/sat', icon: 'satellite', hotkey: 'g>s' },
  { code: 'GS', label: 'Ground stations', path: '/stations', icon: 'station', hotkey: 'g>g' },
  { code: 'ALM', label: 'Alerts', path: '/alerts', icon: 'alarm', hotkey: 'g>a' },
  { code: 'ANL', label: 'Analytics', path: '/analytics', icon: 'chart', hotkey: 'g>n' },
  { code: 'RPL', label: 'Replay', path: '/replay', icon: 'play', hotkey: 'g>r' },
  { code: 'SYS', label: 'System performance', path: '/system', icon: 'gear', hotkey: 'g>y' },
  {
    code: 'ADM',
    label: 'Administration',
    path: '/admin',
    icon: 'user',
    hotkey: 'g>d',
    minRole: 'admin',
  },
];

/** "g>f" -> ["G", "F"] for Kbd hints. */
export function hotkeyCaps(hotkey: string): string[] {
  return hotkey.split('>').map((k) => k.toUpperCase());
}
