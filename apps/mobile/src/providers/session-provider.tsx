import { useQueryClient } from "@tanstack/react-query";
import {
  getSetupStatus,
  indexSetupLibrary,
  isValid,
  login as loginRequest,
  logout as logoutRequest,
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
import { Platform } from "react-native";

import { configureNativeRuntime, normalizeOrigin } from "@/lib/runtime";
import { downloadedRecords, hydrateDownloads } from "@/lib/downloads";
import {
  parseDiscoveryManifest,
  parseDiscoveryManifestResponse,
  serverIdentityChanged,
  type DiscoveryManifest,
  type ServerIdentity,
} from "@/lib/discovery-manifest";
import {
  deleteSecureItem,
  getSecureItem,
  setSecureItem,
} from "@/lib/secure-storage";

const SERVER_KEY = "parson.server-origin";
const TOKEN_KEY = "parson.access-token";
const REFRESH_TOKEN_KEY = "parson.refresh-token";
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
  setupAccount: (username: string, password: string) => Promise<boolean>;
  setupLibrary: (path: string) => Promise<boolean>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function readManifest(origin: string): Promise<DiscoveryManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${origin}/.well-known/parson`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return await parseDiscoveryManifestResponse(response);
  } catch (cause) {
    if (controller.signal.aborted)
      throw new Error("The library did not respond in time.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
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
  const userOperationInFlight = useRef(false);
  const serverIdentity = useRef<ServerIdentity>({
    instanceId: null,
    origin: null,
  });

  const clearAuthentication = useCallback(async () => {
    configureNativeRuntime({ refreshToken: null, token: null });
    setClaims(null);
    await Promise.all([
      deleteSecureItem(TOKEN_KEY),
      deleteSecureItem(REFRESH_TOKEN_KEY),
    ]);
  }, []);

  useEffect(() => {
    configureNativeRuntime({
      unauthorized: () => {
        void clearAuthentication();
        setPhase("login");
      },
      tokenChanged: (next) => {
        void setSecureItem(TOKEN_KEY, next).catch(() => {});
      },
      refreshTokenChanged: (next) => {
        void setSecureItem(REFRESH_TOKEN_KEY, next).catch(() => {});
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
        const manifest = suppliedManifest
          ? parseDiscoveryManifest(suppliedManifest)
          : await readManifest(nextOrigin);
        const setup = await getSetupStatus(`${nextOrigin}/api/v1`);
        if (currentGeneration !== generation.current) return false;
        const previousServer = serverIdentity.current;
        if (
          serverIdentityChanged(previousServer, {
            instanceId: manifest.instanceId,
            origin: nextOrigin,
          })
        ) {
          await clearAuthentication();
          if (currentGeneration !== generation.current) return false;
        }
        configureNativeRuntime({ origin: nextOrigin });
        serverIdentity.current = {
          instanceId: manifest.instanceId,
          origin: nextOrigin,
        };
        setOrigin(nextOrigin);
        setInstanceId(manifest.instanceId);
        setLibraryName(manifest.name);
        await Promise.all([
          setSecureItem(SERVER_KEY, nextOrigin),
          setSecureItem(INSTANCE_KEY, manifest.instanceId),
          setSecureItem(LIBRARY_KEY, manifest.name),
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
    [clearAuthentication, resolveSetup],
  );

  const retry = useCallback(async () => {
    if (origin) await connect(origin);
    else setPhase("discovering");
  }, [connect, origin]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [
        savedOrigin,
        savedToken,
        savedRefreshToken,
        savedInstance,
        savedLibrary,
      ] = await Promise.all([
        getSecureItem(SERVER_KEY),
        getSecureItem(TOKEN_KEY),
        getSecureItem(REFRESH_TOKEN_KEY),
        getSecureItem(INSTANCE_KEY),
        getSecureItem(LIBRARY_KEY),
      ]);
      if (cancelled) return;
      setOrigin(savedOrigin);
      setInstanceId(savedInstance);
      setLibraryName(savedLibrary);
      serverIdentity.current = {
        instanceId: savedInstance,
        origin: savedOrigin,
      };
      configureNativeRuntime({
        origin: savedOrigin,
        refreshToken: savedRefreshToken,
        token: savedToken,
      });
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
    if (userOperationInFlight.current) return false;
    userOperationInFlight.current = true;
    const expectedGeneration = generation.current;
    setError(null);
    setPhase("connecting");
    try {
      const response = await loginRequest(
        {
          username: username.trim(),
          password,
        },
        { native: Platform.OS !== "web" },
      );
      if (expectedGeneration !== generation.current) return false;
      if (!response.status || !response.access_token) {
        setError(response.message || "Sign in failed.");
        setPhase("login");
        return false;
      }
      configureNativeRuntime({
        refreshToken: response.refresh_token ?? null,
        token: response.access_token,
      });
      await Promise.all([
        setSecureItem(TOKEN_KEY, response.access_token),
        response.refresh_token
          ? setSecureItem(REFRESH_TOKEN_KEY, response.refresh_token)
          : deleteSecureItem(REFRESH_TOKEN_KEY),
      ]);
      if (expectedGeneration !== generation.current) return false;
      const session = await isValid();
      if (expectedGeneration !== generation.current) return false;
      if (!session.status || !session.claims) {
        setError(session.message || "The session could not be verified.");
        setPhase("login");
        return false;
      }
      setClaims(session.claims);
      setPhase("ready");
      return true;
    } catch (cause) {
      if (expectedGeneration !== generation.current) return false;
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
      setPhase("login");
      return false;
    } finally {
      userOperationInFlight.current = false;
    }
  }, []);

  const setupAccount = useCallback(
    async (username: string, password: string) => {
      if (userOperationInFlight.current) return false;
      userOperationInFlight.current = true;
      const expectedGeneration = generation.current;
      setError(null);
      setPhase("connecting");
      try {
        const credentials = {
          username: username.trim(),
          password,
          role: "admin",
        };
        const response = await register(credentials);
        if (expectedGeneration !== generation.current) return false;
        if (!response.status) {
          setError(
            response.message || "Could not create the administrator account.",
          );
          setPhase("setup");
          return false;
        }
        const signedIn = await loginRequest(credentials, {
          native: Platform.OS !== "web",
        });
        if (expectedGeneration !== generation.current) return false;
        if (!signedIn.status || !signedIn.access_token) {
          setError(signedIn.message || "Account created. Sign in to continue.");
          setPhase("login");
          return false;
        }
        configureNativeRuntime({
          refreshToken: signedIn.refresh_token ?? null,
          token: signedIn.access_token,
        });
        await Promise.all([
          setSecureItem(TOKEN_KEY, signedIn.access_token),
          signedIn.refresh_token
            ? setSecureItem(REFRESH_TOKEN_KEY, signedIn.refresh_token)
            : deleteSecureItem(REFRESH_TOKEN_KEY),
        ]);
        if (expectedGeneration !== generation.current) return false;
        const next = await getSetupStatus();
        if (expectedGeneration !== generation.current) return false;
        await resolveSetup(next, expectedGeneration);
        return expectedGeneration === generation.current;
      } catch (cause) {
        if (expectedGeneration !== generation.current) return false;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not create the administrator account.",
        );
        setPhase("setup");
        return false;
      } finally {
        userOperationInFlight.current = false;
      }
    },
    [resolveSetup],
  );

  const setupLibrary = useCallback(
    async (path: string) => {
      if (userOperationInFlight.current) return false;
      userOperationInFlight.current = true;
      const expectedGeneration = generation.current;
      setError(null);
      setPhase("indexing");
      try {
        await indexSetupLibrary(path.trim());
        if (expectedGeneration !== generation.current) return false;
        const next = await getSetupStatus();
        if (expectedGeneration !== generation.current) return false;
        await resolveSetup(next, expectedGeneration);
        return expectedGeneration === generation.current;
      } catch (cause) {
        if (expectedGeneration !== generation.current) return false;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not index that folder.",
        );
        setPhase("setup");
        return false;
      } finally {
        userOperationInFlight.current = false;
      }
    },
    [resolveSetup],
  );

  const logout = useCallback(async () => {
    generation.current += 1;
    try {
      await logoutRequest();
    } catch {
      // Local logout must still succeed while the server is unavailable.
    }
    await clearAuthentication();
    setPhase("login");
    // Let the authenticated route tree unmount before notifying every query
    // observer. Clearing synchronously while Expo Router is redirecting can
    // cause nested observer updates on web.
    setTimeout(() => queryClient.clear(), 0);
  }, [clearAuthentication, queryClient]);

  const updateBitrate = useCallback((bitrate: number) => {
    setClaims((value) => (value ? { ...value, bitrate } : value));
  }, []);

  const changeServer = useCallback(async () => {
    generation.current += 1;
    try {
      await logoutRequest();
    } catch {
      // Changing servers must remain available offline.
    }
    await clearAuthentication();
    await Promise.all([
      deleteSecureItem(SERVER_KEY),
      deleteSecureItem(INSTANCE_KEY),
      deleteSecureItem(LIBRARY_KEY),
    ]);
    configureNativeRuntime({ origin: null });
    serverIdentity.current = { instanceId: null, origin: null };
    setOrigin(null);
    setInstanceId(null);
    setLibraryName(null);
    setError(null);
    setPhase("discovering");
    setTimeout(() => queryClient.clear(), 0);
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
