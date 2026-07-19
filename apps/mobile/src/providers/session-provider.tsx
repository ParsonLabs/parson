import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import {
  getSetupStatus,
  indexSetupLibrary,
  isValid,
  login as loginRequest,
  register,
  type SetupStatus,
} from "@parson/music-sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { configureNativeRuntime, normalizeOrigin } from "@/lib/runtime";
import { downloadedRecords, hydrateDownloads } from "@/lib/downloads";

const SERVER_KEY = "parson.server-origin";
const TOKEN_KEY = "parson.access-token";
const INSTANCE_KEY = "parson.instance-id";
const LIBRARY_KEY = "parson.library-name";

export type SessionPhase =
  | "loading"
  | "discovering"
  | "connecting"
  | "login"
  | "indexing"
  | "setup"
  | "offline"
  | "ready";

type Claims = NonNullable<Awaited<ReturnType<typeof isValid>>["claims"]>;

type SessionContextValue = {
  claims: Claims | null;
  error: string | null;
  instanceId: string | null;
  libraryName: string | null;
  origin: string | null;
  phase: SessionPhase;
  setupStatus: SetupStatus | null;
  connect: (origin: string, manifest?: DiscoveryManifest) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  changeServer: () => Promise<void>;
  retry: () => Promise<void>;
  updateBitrate: (bitrate: number) => void;
  setupAccount: (
    username: string,
    password: string,
    setupCode?: string,
  ) => Promise<boolean>;
  setupLibrary: (path: string) => Promise<boolean>;
};

export type DiscoveryManifest = {
  protocol: string;
  protocolVersion: number;
  instanceId: string;
  name: string;
  product: string;
  serverVersion: string;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function readManifest(origin: string): Promise<DiscoveryManifest> {
  const response = await fetch(`${origin}/.well-known/parson`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Library returned HTTP ${response.status}.`);
  const manifest = (await response.json()) as DiscoveryManifest;
  if (
    manifest.protocol !== "parson" ||
    manifest.protocolVersion !== 1 ||
    manifest.product !== "parson-music" ||
    !manifest.instanceId
  ) {
    throw new Error("This is not a compatible Parson library.");
  }
  return manifest;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<SessionPhase>("loading");
  const [origin, setOrigin] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claims | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const generation = useRef(0);

  const clearAuthentication = useCallback(async () => {
    configureNativeRuntime({ token: null });
    setClaims(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  useEffect(() => {
    configureNativeRuntime({
      unauthorized: () => {
        void clearAuthentication();
        setPhase("login");
      },
      tokenChanged: (next) => {
        void SecureStore.setItemAsync(TOKEN_KEY, next);
      },
    });
  }, [clearAuthentication]);

  const resolveSetup = useCallback(
    async (initialSetup: SetupStatus, expectedGeneration: number) => {
      let setup = initialSetup;
      while (setup.library_state === "indexing") {
        if (expectedGeneration !== generation.current) return;
        setPhase("indexing");
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (expectedGeneration !== generation.current) return;
        setup = await getSetupStatus();
      }
      if (expectedGeneration !== generation.current) return;
      if (setup.setup_required) {
        setSetupStatus(setup);
        setPhase("setup");
        return;
      }
      const session = await isValid();
      if (expectedGeneration !== generation.current) return;
      if (session.status && session.claims) {
        setSetupStatus(null);
        setClaims(session.claims);
        setPhase("ready");
      } else {
        await clearAuthentication();
        setPhase("login");
      }
    },
    [clearAuthentication],
  );

  const connect = useCallback(
    async (value: string, suppliedManifest?: DiscoveryManifest) => {
      const currentGeneration = ++generation.current;
      setError(null);
      setPhase("connecting");
      try {
        const nextOrigin = normalizeOrigin(value);
        const manifest = suppliedManifest ?? (await readManifest(nextOrigin));
        configureNativeRuntime({ origin: nextOrigin });
        const setup = await getSetupStatus();
        if (currentGeneration !== generation.current) return false;
        setOrigin(nextOrigin);
        setInstanceId(manifest.instanceId);
        setLibraryName(manifest.name);
        await Promise.all([
          SecureStore.setItemAsync(SERVER_KEY, nextOrigin),
          SecureStore.setItemAsync(INSTANCE_KEY, manifest.instanceId),
          SecureStore.setItemAsync(LIBRARY_KEY, manifest.name),
        ]);
        await resolveSetup(setup, currentGeneration);
        return true;
      } catch (cause) {
        if (currentGeneration !== generation.current) return false;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not reach that library.",
        );
        await hydrateDownloads();
        setPhase(downloadedRecords().length ? "offline" : "discovering");
        return false;
      }
    },
    [resolveSetup],
  );

  const retry = useCallback(async () => {
    if (origin) await connect(origin);
    else setPhase("discovering");
  }, [connect, origin]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [savedOrigin, savedToken, savedInstance, savedLibrary] =
        await Promise.all([
          SecureStore.getItemAsync(SERVER_KEY),
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(INSTANCE_KEY),
          SecureStore.getItemAsync(LIBRARY_KEY),
        ]);
      if (cancelled) return;
      setOrigin(savedOrigin);
      setInstanceId(savedInstance);
      setLibraryName(savedLibrary);
      configureNativeRuntime({ origin: savedOrigin, token: savedToken });
      if (!savedOrigin) {
        setPhase("discovering");
        return;
      }
      await hydrateDownloads();
      if (cancelled) return;
      if (downloadedRecords().length) {
        if (!(await connect(savedOrigin)) && !cancelled) setPhase("offline");
        return;
      }
      for (let attempt = 0; attempt < 8 && !cancelled; attempt += 1) {
        if (await connect(savedOrigin)) return;
        if (attempt < 7)
          await new Promise((resolve) => setTimeout(resolve, 750));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connect]);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    setPhase("connecting");
    try {
      const response = await loginRequest({
        username: username.trim(),
        password,
      });
      if (!response.status || !response.access_token) {
        setError(response.message || "Sign in failed.");
        setPhase("login");
        return false;
      }
      configureNativeRuntime({ token: response.access_token });
      await SecureStore.setItemAsync(TOKEN_KEY, response.access_token);
      const session = await isValid();
      if (!session.status || !session.claims) {
        setError(session.message || "The session could not be verified.");
        setPhase("login");
        return false;
      }
      setClaims(session.claims);
      setPhase("ready");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
      setPhase("login");
      return false;
    }
  }, []);

  const setupAccount = useCallback(
    async (username: string, password: string, setupCode?: string) => {
      setError(null);
      setPhase("connecting");
      const response = await register({
        username: username.trim(),
        password,
        setup_code: setupCode?.trim() || undefined,
      });
      if (!response.status || !response.access_token) {
        setError(
          response.message || "Could not create the administrator account.",
        );
        setPhase("setup");
        return false;
      }
      configureNativeRuntime({ token: response.access_token });
      await SecureStore.setItemAsync(TOKEN_KEY, response.access_token);
      const next = await getSetupStatus();
      await resolveSetup(next, generation.current);
      return true;
    },
    [resolveSetup],
  );

  const setupLibrary = useCallback(
    async (path: string) => {
      setError(null);
      setPhase("indexing");
      try {
        await indexSetupLibrary(path.trim());
        const next = await getSetupStatus();
        await resolveSetup(next, generation.current);
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not index that folder.",
        );
        setPhase("setup");
        return false;
      }
    },
    [resolveSetup],
  );

  const logout = useCallback(async () => {
    generation.current += 1;
    queryClient.clear();
    await clearAuthentication();
    setPhase("login");
  }, [clearAuthentication, queryClient]);

  const updateBitrate = useCallback((bitrate: number) => {
    setClaims((value) => (value ? { ...value, bitrate } : value));
  }, []);

  const changeServer = useCallback(async () => {
    generation.current += 1;
    queryClient.clear();
    await clearAuthentication();
    await Promise.all([
      SecureStore.deleteItemAsync(SERVER_KEY),
      SecureStore.deleteItemAsync(INSTANCE_KEY),
      SecureStore.deleteItemAsync(LIBRARY_KEY),
    ]);
    configureNativeRuntime({ origin: null });
    setOrigin(null);
    setInstanceId(null);
    setLibraryName(null);
    setError(null);
    setPhase("discovering");
  }, [clearAuthentication, queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({
      claims,
      error,
      instanceId,
      libraryName,
      origin,
      phase,
      setupStatus,
      changeServer,
      connect,
      login,
      logout,
      retry,
      updateBitrate,
      setupAccount,
      setupLibrary,
    }),
    [
      changeServer,
      claims,
      connect,
      error,
      instanceId,
      libraryName,
      login,
      logout,
      origin,
      phase,
      retry,
      updateBitrate,
      setupAccount,
      setupLibrary,
      setupStatus,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context)
    throw new Error("useSession must be used inside SessionProvider.");
  return context;
}
