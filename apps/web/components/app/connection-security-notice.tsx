"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { isInsecureHttpOrigin } from "@parson/music-sdk";

export default function ConnectionSecurityNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isInsecureHttpOrigin(window.location.origin));
  }, []);

  if (!visible) return null;

  return (
    <aside
      aria-label="Connection security warning"
      className="fixed bottom-[84px] left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-950/95 px-4 py-3 text-amber-50 shadow-2xl backdrop-blur md:bottom-5"
      role="status"
    >
      <ShieldAlert
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-300"
      />
      <div>
        <p className="text-sm font-semibold">This connection is not private</p>
        <p className="mt-0.5 text-xs leading-5 text-amber-100/80">
          Use this HTTP address only on a network you trust. Configure HTTPS
          before accessing Parson over the internet.
        </p>
      </div>
    </aside>
  );
}
