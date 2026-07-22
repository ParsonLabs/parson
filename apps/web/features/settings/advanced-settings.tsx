"use client";

import { useEffect, useState } from "react";

export default function AdvancedSettings() {
  const [address, setAddress] = useState("");
  useEffect(() => setAddress(window.location.origin), []);

  const origin = address ? new URL(address) : null;
  const rows = [
    ["Port", origin?.port || (origin?.protocol === "https:" ? "443" : "80")],
    ["Network interface", origin?.hostname || "—"],
    ["Database location", "Managed by Parson"],
    ["Cache", "Managed automatically"],
  ];

  return (
    <div>
      <h2 className="text-base font-semibold text-white">Hosting details</h2>
      <p className="mt-1 max-w-xl text-sm text-zinc-500">
        Technical information for troubleshooting and custom hosting setups.
      </p>
      <dl className="mt-5 overflow-hidden rounded-lg border border-white/10">
        {rows.map(([label, value]) => (
          <div
            className="grid gap-1 border-b border-white/[0.08] px-4 py-3 last:border-0 sm:grid-cols-[180px_1fr]"
            key={label}
          >
            <dt className="text-sm text-zinc-500">{label}</dt>
            <dd className="truncate text-sm text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
