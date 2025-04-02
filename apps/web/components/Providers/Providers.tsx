"use client";

import { ReactNode } from "react";
import AIOverlayProvider from "../AI/AIOverlayContext";
import LyricsOverlayProvider from "../Lyrics/LyricsOverlayContext";
import { PlayerProvider } from "../Music/Player/usePlayer";
import PanelProvider from "../Music/Queue/QueuePanelContext";
import { GradientHoverProvider } from "./GradientHoverProvider";
import { ScrollProvider } from "./ScrollProvider";
import SidebarProvider from "./SideBarProvider";
import { ThemeProvider } from "./ThemeProvider";
import { SlowedReverbProvider } from "./SlowedReverbProvider";
import { LayoutConfigProvider } from "./LayoutConfigContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// import { createAuthMiddleware } from "../Authentication/AuthMiddleware";
import AuthProvider from "./AuthProvider";
import { TooltipProvider } from "@music/ui/components/tooltip";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  // queryClient.setDefaultOptions({
  //   mutations: {
  //     onMutate: createAuthMiddleware(queryClient),
  //   },
  //   queries: {
  //     queryFn: createAuthMiddleware(queryClient),
  //   },
  // });

  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <LayoutConfigProvider>
          <GradientHoverProvider>
            <ScrollProvider>
              <SidebarProvider>
                <SlowedReverbProvider>
                  <PlayerProvider>
                    <PanelProvider>
                      <LyricsOverlayProvider>
                        <TooltipProvider>
                          <AIOverlayProvider>{children}</AIOverlayProvider>
                        </TooltipProvider>
                      </LyricsOverlayProvider>
                    </PanelProvider>
                  </PlayerProvider>
                </SlowedReverbProvider>
              </SidebarProvider>
            </ScrollProvider>
          </GradientHoverProvider>
        </LayoutConfigProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
