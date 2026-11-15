// Authenticated app frame: console bar on top, nav rail on the left, routed page in the main area.
import { Outlet } from 'react-router';
import { RealtimeBridge } from './RealtimeBridge.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import { ConsoleBar } from './ConsoleBar.tsx';
import { NavRail } from './NavRail.tsx';
import { TourProvider } from '../features/tour/TourProvider.tsx';

export function AppShell() {
  return (
    <TourProvider>
      <div className="flex h-full flex-col bg-bg">
        <RealtimeBridge />
        <ConsoleBar />
        <div className="flex min-h-0 flex-1">
          <NavRail />
          <main id="main" className="min-h-0 min-w-0 flex-1 overflow-auto p-1">
            <Outlet />
          </main>
        </div>
        <CommandPalette />
      </div>
    </TourProvider>
  );
}
