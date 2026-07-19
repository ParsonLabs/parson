import type { ReactNode } from "react";
import AppShell from "./app-shell";
import AppProviders from "@/components/app/providers";
import PlayerBar from "@/features/player/player-bar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <AppShell>{children}</AppShell>
      <PlayerBar />
    </AppProviders>
  );
}
