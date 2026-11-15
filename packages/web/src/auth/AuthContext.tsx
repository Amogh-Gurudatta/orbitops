// Session context: current user from GET /auth/me (TanStack Query), login/logout actions and role checks.
// React 19: the context object is rendered directly as the provider.
import { createContext, use, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@orbitops/shared';
import { ApiError, api, setSessionLostHandler } from '../api/client.ts';
import { queryKeys } from '../api/endpoints.ts';
import type { User } from '../api/types.ts';
import { realtime } from '../realtime/client.ts';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface Session {
  user: User | null;
  status: SessionStatus;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  /** True when the signed-in user's role is at least `role` (viewer < operator < admin). */
  can(role: Role): boolean;
}

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

const AuthContext = createContext<Session | null>(null);

/** /auth/me resolves to null (not an error) for an anonymous visitor. */
async function fetchSessionUser(): Promise<User | null> {
  try {
    return (await api.get<{ user: User }>('/auth/me')).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchSessionUser,
    staleTime: Infinity,
    // The login cookie is shared by every tab and window of a browser profile. Re-check it on focus so a
    // sign-in elsewhere (e.g. a viewer in another window) is reflected here instead of leaving a stale role.
    refetchOnWindowFocus: 'always',
  });

  useEffect(() => {
    setSessionLostHandler(() => queryClient.setQueryData(queryKeys.me, null));
    return () => setSessionLostHandler(null);
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.post<{ user: User }>('/auth/login', { email, password });
      queryClient.setQueryData(queryKeys.me, user);
      return user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // The cookie may already be gone; the local session ends regardless.
    }
    realtime.stop();
    realtime.reset();
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    queryClient.setQueryData(queryKeys.me, null);
  }, [queryClient]);

  const user = me.data ?? null;

  // If the account behind the cookie changed under us, the open socket still belongs to the old one.
  const lastUserId = useRef<string | null>(null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (lastUserId.current !== null && id !== null && id !== lastUserId.current) {
      realtime.stop();
      realtime.reset();
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    }
    lastUserId.current = id;
  }, [user?.id, queryClient]);
  const status: SessionStatus = me.isPending ? 'loading' : user ? 'authenticated' : 'anonymous';

  const session = useMemo<Session>(
    () => ({
      user,
      status,
      login,
      logout,
      can: (role) => user !== null && RANK[user.role] >= RANK[role],
    }),
    [user, status, login, logout],
  );

  return <AuthContext value={session}>{children}</AuthContext>;
}

export function useSession(): Session {
  const session = use(AuthContext);
  if (!session) throw new Error('useSession must be used inside <AuthProvider>');
  return session;
}
