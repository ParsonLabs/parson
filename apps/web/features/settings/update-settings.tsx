"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  desktopUpdates,
  hasDesktopBridge,
  watchDesktopUpdates,
  type DesktopUpdateState,
} from "@/lib/desktop/bridge";

function updateMessage(state: DesktopUpdateState) {
  switch (state.status) {
    case "ready":
      return `Parson ${state.availableVersion} is ready`;
    case "downloading": {
      const progress = state.percent == null ? "" : ` · ${state.percent}%`;
      return `Downloading ${state.availableVersion}${progress}`;
    }
    case "checking":
      return "Checking for updates";
    case "current":
      return "Up to date";
    default:
      return state.message || `Parson ${state.version}`;
  }
}

export default function UpdateSettings() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasDesktopBridge()) {
      return;
    }
    let active = true;
    const receive = (next: DesktopUpdateState) => {
      if (active) {
        setState(next);
      }
    };
    const unsubscribe = watchDesktopUpdates(receive);
    void desktopUpdates("state")
      .then((next) => {
        if (next) {
          receive(next);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!state) {
    return null;
  }

  const handleUpdate = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await desktopUpdates(
        state.status === "ready" ? "install" : "check",
      );
      if (next) {
        setState(next);
      }
    } catch {
      setError("Could not update Parson. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const message = updateMessage(state);

  return (
    <section className="mt-8 border-t border-white/8 pt-6">
      <h2 className="text-base font-semibold text-white">Updates</h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <p aria-live="polite" className="text-sm text-zinc-500">
          {error || message}
        </p>
        {state.status === "manual" ? (
          <Button asChild variant="outline">
            <a href={state.releaseUrl} target="_blank" rel="noreferrer">
              View releases
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={
              busy ||
              state.status === "checking" ||
              state.status === "downloading"
            }
            onClick={handleUpdate}
          >
            {state.status === "ready"
              ? "Restart to update"
              : "Check for updates"}
          </Button>
        )}
      </div>
    </section>
  );
}
