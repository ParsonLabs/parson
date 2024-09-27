import { ReactNode } from 'react';
import AIOverlayProvider from '../AI/AIOverlayContext';
import LyricsOverlayProvider from '../Lyrics/LyricsOverlayContext';
import { PlayerProvider } from '../Music/Player/usePlayer';
import PanelProvider from '../Music/Queue/QueuePanelContext';
import { GradientHoverProvider } from './GradientHoverProvider';
import { ScrollProvider } from './ScrollProvider';
import SidebarProvider from './SideBarProvider';
import { ThemeProvider } from './ThemeProvider';
import { SlowedReverbProvider } from './SlowedReverbProvider';
import { LayoutConfigProvider } from './LayoutConfigContext';

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <LayoutConfigProvider>
        <GradientHoverProvider>
          <ScrollProvider>
            <SidebarProvider>
              <SlowedReverbProvider>
                <PlayerProvider>
                  <PanelProvider>
                    <LyricsOverlayProvider>
                      <AIOverlayProvider>
                        {children}
                      </AIOverlayProvider>
                    </LyricsOverlayProvider>
                  </PanelProvider>
                </PlayerProvider>
              </SlowedReverbProvider>
            </SidebarProvider>
          </ScrollProvider>
        </GradientHoverProvider>
      </LayoutConfigProvider>
    </ThemeProvider>
  );
}