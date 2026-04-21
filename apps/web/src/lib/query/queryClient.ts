import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, err: unknown) => {
        const status = (err as { status?: number } | null)?.status;
        if (status && [401, 403, 404].includes(status)) return false;
        return failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});
