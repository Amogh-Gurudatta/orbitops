// Route table (react-router data mode). Pages are lazy so heavy feature code (deck.gl, ECharts)
// loads only with the page that needs it. Each page module exports `Component`.
import { createBrowserRouter } from 'react-router';
import { RequireAuth, RequireRole } from './auth/guards.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { LoadingState } from './ui/index.ts';

function HydrateFallback() {
  return (
    <div className="h-full bg-bg">
      <LoadingState label="INITIALISING CONSOLE" />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    HydrateFallback,
    children: [
      { path: '/login', lazy: () => import('./pages/LoginPage.tsx') },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, lazy: () => import('./pages/FleetPage.tsx') },
              { path: 'sat/:satId?', lazy: () => import('./pages/SatellitePage.tsx') },
              { path: 'stations', lazy: () => import('./pages/StationsPage.tsx') },
              { path: 'alerts', lazy: () => import('./pages/AlertsPage.tsx') },
              { path: 'analytics', lazy: () => import('./pages/AnalyticsPage.tsx') },
              { path: 'replay', lazy: () => import('./pages/ReplayPage.tsx') },
              { path: 'system', lazy: () => import('./pages/SystemPage.tsx') },
              {
                element: <RequireRole role="admin" />,
                children: [{ path: 'admin', lazy: () => import('./pages/AdminPage.tsx') }],
              },
              { path: '*', lazy: () => import('./pages/NotFoundPage.tsx') },
            ],
          },
        ],
      },
    ],
  },
]);
