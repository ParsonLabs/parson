"use client";

import BitrateForm from "@/features/settings/bitrate-form";
import FileBrowser from "@/features/setup/file-browser";
import AccountSettings from "@/features/settings/account-settings";
import UserForm from "@/features/settings/user-form";
import { useSession } from "@/features/account/session-provider";
import { getSetupStatus } from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import ServerConnectionPanel from "@/features/server/server-connection-panel";

const settingsTabs = [
  "account",
  "playback",
  "server",
  "library",
  "users",
] as const;
type SettingsTab = (typeof settingsTabs)[number];

const labels: Record<SettingsTab, string> = {
  account: "Account",
  playback: "Playback",
  server: "Server",
  library: "Library",
  users: "Users",
};

export default function SettingsPage() {
  const { session } = useSession();
  const isAdmin = session?.role === "admin";
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const availableTabs = isAdmin ? settingsTabs : settingsTabs.slice(0, 3);
  const setup = useQuery({
    queryKey: ["setup-status", "settings-library"],
    queryFn: () => getSetupStatus(),
    enabled: Boolean(isAdmin && activeTab === "library"),
  });
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: SettingsTab,
  ) => {
    const currentIndex = availableTabs.indexOf(tab);
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % availableTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = availableTabs.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = availableTabs[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab);
    document.getElementById(`settings-tab-${nextTab}`)?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-9 pb-36 sm:px-7">
      <h1 className="mb-9 text-3xl font-semibold text-white">Settings</h1>
      <section className="max-w-3xl">
        <div
          aria-label="Settings sections"
          className="flex gap-1 overflow-x-auto border-b border-white/[0.08]"
          role="tablist"
        >
          {availableTabs.map((tab) => (
            <button
              aria-controls={`settings-panel-${tab}`}
              aria-selected={activeTab === tab}
              className={`relative h-11 shrink-0 px-4 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
              id={`settings-tab-${tab}`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, tab)}
              role="tab"
              tabIndex={activeTab === tab ? 0 : -1}
              type="button"
            >
              {labels[tab]}
              {activeTab === tab && (
                <span className="absolute inset-x-3 bottom-0 h-0.5 bg-white" />
              )}
            </button>
          ))}
        </div>

        <div
          aria-labelledby={`settings-tab-${activeTab}`}
          className="pt-8"
          id={`settings-panel-${activeTab}`}
          role="tabpanel"
        >
          {activeTab === "account" && <AccountSettings />}
          {activeTab === "playback" && (
            <BitrateForm initialBitrate={session?.bitrate ?? 0} />
          )}
          {activeTab === "server" && <ServerConnectionPanel />}
          {isAdmin &&
            activeTab === "library" &&
            (setup.data ? (
              <FileBrowser
                initialDirectory={setup.data.suggested_library_path}
              />
            ) : (
              <div className="flex min-h-64 items-center justify-center text-zinc-500">
                <Loader2
                  className="h-5 w-5 animate-spin"
                  aria-label="Loading library folder"
                />
              </div>
            ))}
          {isAdmin && activeTab === "users" && <UserForm />}
        </div>
      </section>
    </div>
  );
}
