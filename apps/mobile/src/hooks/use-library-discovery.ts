import { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import ParsonDiscovery from "../../modules/parson-discovery";
import {
  parseDiscoveryManifestResponse,
  type DiscoveryManifest,
} from "@/lib/discovery-manifest";
import { useSession } from "@/providers/session-provider";

export type NearbyLibrary = {
  manifest: DiscoveryManifest;
  origin: string;
};

async function inspectLibrary(origin: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${origin}/.well-known/parson`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return await parseDiscoveryManifestResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function useLibraryDiscovery() {
  const { phase } = useSession();
  const [libraries, setLibraries] = useState<NearbyLibrary[]>([]);
  const inspected = useRef(new Set<string>());
  useEffect(() => {
    if (phase !== "discovering") return;
    let active = true;
    const subscription = ParsonDiscovery.addListener(
      "onService",
      ({ host, port }) => {
        const origin = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
        if (inspected.current.has(origin)) return;
        inspected.current.add(origin);
        void inspectLibrary(origin)
          .then((manifest) => {
            if (!active) return;
            setLibraries((current) =>
              [
                ...current.filter(
                  (library) =>
                    library.origin !== origin &&
                    library.manifest.instanceId !== manifest.instanceId,
                ),
                { manifest, origin },
              ].sort((left, right) =>
                left.manifest.name.localeCompare(right.manifest.name),
              ),
            );
          })
          .catch(() => {
            setTimeout(() => inspected.current.delete(origin), 5_000);
          });
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
      subscription.remove();
      ParsonDiscovery.stop();
    };
  }, [phase]);
  return libraries;
}
