// Route guards: RequireAuth redirects anonymous visitors to /login; RequireRole blocks by role.
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '@orbitops/shared';
import { EmptyState, LoadingState } from '../ui/index.ts';
import { useSession } from './AuthContext.tsx';

export function RequireAuth() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="h-full bg-bg">
        <LoadingState label="VERIFYING SESSION" />
      </div>
    );
  }
  if (status === 'anonymous')
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function RequireRole({ role }: { role: Role }) {
  const { can } = useSession();
  if (!can(role)) {
    return (
      <EmptyState
        title="ACCESS RESTRICTED"
        detail={`This view requires the ${role.toUpperCase()} role. Sign on with a different account to continue.`}
      />
    );
  }
  return <Outlet />;
}
