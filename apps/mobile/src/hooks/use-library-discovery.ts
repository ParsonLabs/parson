import { useEffect, useRef } from "react";

import ParsonDiscovery from "../../modules/parson-discovery";
import { useSession } from "@/providers/session-provider";

export function useLibraryDiscovery() {
  const { connect, phase } = useSession();
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (phase !== "discovering") return;
    const subscription = ParsonDiscovery.addListener(
      "onService",
      ({ host, port }) => {
        const origin = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
        if (attempted.current.has(origin)) return;
        attempted.current.add(origin);
        void connect(origin).then((connected) => {
          if (!connected)
            setTimeout(() => attempted.current.delete(origin), 5000);
        });
      },
    );
    ParsonDiscovery.start();
    return () => {
      subscription.remove();
      ParsonDiscovery.stop();
    };
  }, [connect, phase]);
}
