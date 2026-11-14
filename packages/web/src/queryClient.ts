// Shared TanStack Query client. Server data (catalogue, history, alerts lists) is cached here;
// high-rate telemetry is NOT: it lives in realtime/telemetryStore.
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Auth failures are handled by the client's refresh path; do not hammer on 4xx.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
  },
});
