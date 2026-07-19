"use client";

import { ReactNode, Suspense, useState } from "react";
import { PlayerProvider } from "@/features/player/player-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TitleMetadata from "@/components/app/title-metadata";
import { getLibraryUnavailable, isApiError } from "@parson/music-sdk";

interface AppProvidersProps {
  children: ReactNode;
}

export default function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) => {
              if (failureCount >= 2) return false;
              if (getLibraryUnavailable(error)) return false;
              if (!isApiError(error) || !error.response) return true;
              const status = error.response.status;
              return status === 408 || status === 429 || status >= 500;
            },
            retryDelay: (attempt) => Math.min(750 * 2 ** attempt, 5000),
            refetchOnWindowFocus: false,
            staleTime: 1000 * 60,
            gcTime: 1000 * 60 * 30,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <Suspense>
          <TitleMetadata />
        </Suspense>
        {children}
      </PlayerProvider>
    </QueryClientProvider>
  );
}
