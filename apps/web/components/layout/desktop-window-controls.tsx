"use client";

import { electronWindowControls } from "@/lib/desktop/bridge";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

export function DesktopWindowControls() {
  const [controls, setControls] =
    useState<ReturnType<typeof electronWindowControls>>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const next = electronWindowControls();
    if (!next) return;
    setControls(next);
    void next.isMaximized().then(setMaximized);
    next.watchMaximized(setMaximized);
  }, []);

  if (!controls) return null;

  return (
    <div
      aria-label="Window controls"
      className="electron-titlebar-no-drag absolute right-0 top-0 flex h-full items-stretch"
      role="group"
    >
      <button
        aria-label="Minimize"
        className="flex w-12 items-center justify-center text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        onClick={() => void controls.minimize()}
        title="Minimize"
        type="button"
      >
        <Minus className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <button
        aria-label={maximized ? "Restore window" : "Maximize"}
        className="flex w-12 items-center justify-center text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        onClick={() => void controls.toggleMaximize().then(setMaximized)}
        title={maximized ? "Restore" : "Maximize"}
        type="button"
      >
        {maximized ? (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
        ) : (
          <Square className="h-3.5 w-3.5" strokeWidth={1.5} />
        )}
      </button>
      <button
        aria-label="Close"
        className="flex w-12 items-center justify-center text-zinc-400 transition-colors hover:bg-red-600 hover:text-white"
        onClick={() => void controls.close()}
        title="Close"
        type="button"
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
