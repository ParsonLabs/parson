import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Parson account, playback, server, and library.",
};

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
