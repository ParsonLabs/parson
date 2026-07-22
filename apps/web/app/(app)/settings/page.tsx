"use client";

import BitrateForm from "@/features/settings/bitrate-form";
import AccountSettings from "@/features/settings/account-settings";
import AdvancedSettings from "@/features/settings/advanced-settings";
import LibrarySettings from "@/features/settings/library-settings";
import UserForm from "@/features/settings/user-form";
import { useSession } from "@/features/account/session-provider";
import { useState } from "react";
import ServerConnectionPanel from "@/features/server/server-connection-panel";

const settingsTabs = [
  "account",
  "playback",
  "library",
  "devices",
  "users",
  "advanced",
] as const;
type SettingsTab = (typeof settingsTabs)[number];

const labels: Record<SettingsTab, string> = {
  account: "Account",
  playback: "Playback",
  library: "Library",
  devices: "Connections",
  users: "Users",
  advanced: "Advanced",
};

export default function SettingsPage() {
  const { session } = useSession();
  const isAdmin = session?.role === "admin";
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const availableTabs = isAdmin
    ? settingsTabs
    : (["account", "playback", "devices"] as const);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-9 pb-36 sm:px-7">
      <h1 className="mb-9 text-3xl font-semibold text-white">Settings</h1>
      <section className="grid items-start gap-8 md:grid-cols-[170px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="flex gap-1 overflow-x-auto border-b border-white/[0.08] pb-2 md:grid md:border-0 md:pb-0"
        >
          {availableTabs.map((tab) => (
            <button
              aria-current={activeTab === tab ? "page" : undefined}
              className={`shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-white/[0.08] text-white"
                  : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
              }`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {labels[tab]}
            </button>
          ))}
        </nav>

        <div className="min-w-0" id={`settings-panel-${activeTab}`}>
          {activeTab === "account" && <AccountSettings />}
          {activeTab === "playback" && (
            <BitrateForm initialBitrate={session?.bitrate ?? 0} />
          )}
          {activeTab === "devices" && <ServerConnectionPanel />}
          {isAdmin && activeTab === "library" && <LibrarySettings />}
          {isAdmin && activeTab === "users" && <UserForm />}
          {isAdmin && activeTab === "advanced" && <AdvancedSettings />}
        </div>
      </section>
    </div>
  );
}
