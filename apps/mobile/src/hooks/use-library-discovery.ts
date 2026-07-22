import { useEffect, useRef } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import ParsonDiscovery from "../../modules/parson-discovery";
import { useSession } from "@/providers/session-provider";

export function useLibraryDiscovery() {
  const { connect, phase } = useSession();
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (phase !== "discovering") return;
    let active = true;
    let running = false;
    const pending: string[] = [];
    const tryPending = async () => {
      if (running) return;
      running = true;
      while (active) {
        const origin = pending.shift();
        if (!origin) break;
        const connected = await connect(origin);
        if (connected) {
          pending.length = 0;
          break;
        }
        setTimeout(() => attempted.current.delete(origin), 5000);
      }
      running = false;
    };
    const subscription = ParsonDiscovery.addListener(
      "onService",
      ({ host, port }) => {
        const origin = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
        if (attempted.current.has(origin)) return;
        attempted.current.add(origin);
        pending.push(origin);
        void tryPending();
      },
    );
    void (async () => {
      try {
        if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
          const permission = PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES;
          if (!(await PermissionsAndroid.check(permission))) {
            await PermissionsAndroid.request(permission, {
              title: "Find your Parson library",
              message:
                "Allow nearby-device access so Parson can find music libraries on this network.",
              buttonPositive: "Allow",
              buttonNegative: "Not now",
            });
          }
        }
      } finally {
        if (active) ParsonDiscovery.start();
      }
    })();
    return () => {
      active = false;
      pending.length = 0;
      subscription.remove();
      ParsonDiscovery.stop();
    };
  }, [connect, phase]);
}
