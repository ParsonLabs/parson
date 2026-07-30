import { useQueryClient } from "@tanstack/react-query";
import {
  changeUsername as changeUsernameRequest,
  checkDevicePairing,
  getSetupStatus,
  indexSetupLibrary,
  isValid,
  login as loginRequest,
  logout as logoutRequest,
  register,
  startDevicePairing,
  type SetupStatus,
} from "@parson/music-sdk";
import * as Device from "expo-device";
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

import {
  configureNativeRuntime,
  embeddedWebClientTarget,
  normalizeOrigin,
} from "@/lib/runtime";
import { downloadedRecords, hydrateDownloads } from "@/lib/downloads";
import {
  parseDiscoveryManifest,
  parseDiscoveryManifestResponse,
  savedAddressWasReplaced,
  SERVER_REPLACEMENT_WARNING,
  serverIdentityChanged,
  type DiscoveryManifest,
  type ServerIdentity,
} from "@/lib/discovery-manifest";
import {
  deleteSecureItem,
  getSecureItem,
  setSecureItem,
} from "@/lib/secure-storage";
import {
  accountKey,
  parseStoredAccounts,
  renameStoredAccount,
  upsertStoredAccount,
  type StoredAccount,
} from "@/lib/saved-accounts";

const SERVER_KEY = "parson.server-origin";
const TOKEN_KEY = "parson.access-token";
const REFRESH_TOKEN_KEY = "parson.refresh-token";
const INSTANCE_KEY = "parson.instance-id";
const LIBRARY_KEY = "parson.library-name";
const ACCOUNTS_KEY = "parson.saved-accounts";

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
  pairing: { code: string; expiresAt: number } | null;
  savedAccounts: { current: boolean; key: string; username: string }[];
  phase: SessionPhase;
  setupStatus: SetupStatus | null;
  connect: (origin: string, manifest?: DiscoveryManifest) => Promise<boolean>;
  confirmServerReplacement: () => Promise<boolean>;
  cancelServerReplacement: () => void;
  serverReplacementPending: boolean;
  cancelPairing: () => void;
  login: (username: string, password: string) => Promise<boolean>;
  startPairing: () => Promise<void>;
  switchAccount: (key: string) => Promise<boolean>;
  logout: () => Promise<void>;
  changeServer: () => Promise<void>;
  changeUsername: (
    username: string,
    currentPassword: string,
  ) => Promise<boolean>;
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
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: number;
  } | null>(null);
  const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>([]);
  const [serverReplacementPending, setServerReplacementPending] =
    useState(false);
  const generation = useRef(0);
  const pairingGeneration = useRef(0);
  const userOperationInFlight = useRef(false);
  const serverIdentity = useRef<ServerIdentity>({
    instanceId: null,
    origin: null,
  });
  const pendingServerReplacement = useRef<{
    manifest: DiscoveryManifest;
    origin: string;
  } | null>(null);
  const storedAccountsRef = useRef<StoredAccount[]>([]);
  const activeAccountRef = useRef<{
    instanceId: string;
    sub: string;
  } | null>(null);

  const replaceStoredAccounts = useCallback((accounts: StoredAccount[]) => {
    storedAccountsRef.current = accounts;
    setStoredAccounts(accounts);
    void setSecureItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }, []);

  const updateStoredAccountToken = useCallback(
    (field: "accessToken" | "refreshToken", token: string | null) => {
      const active = activeAccountRef.current;
      if (!active) return;
      const next = storedAccountsRef.current.map((account) =>
        account.instanceId === active.instanceId && account.sub === active.sub
          ? { ...account, [field]: token }
          : account,
      );
      replaceStoredAccounts(next);
    },
    [replaceStoredAccounts],
  );

  const clearAuthentication = useCallback(async () => {
    configureNativeRuntime({ refreshToken: null, token: null });
    setClaims(null);
    await Promise.all([
      deleteSecureItem(TOKEN_KEY),
      deleteSecureItem(REFRESH_TOKEN_KEY),
    ]);
  }, []);

  const storeNativeAuthentication = useCallback(
    async (accessToken: string, refreshToken?: string | null) => {
      configureNativeRuntime({
        refreshToken: refreshToken ?? null,
        token: accessToken,
      });
      await Promise.all([
        setSecureItem(TOKEN_KEY, accessToken),
        refreshToken
          ? setSecureItem(REFRESH_TOKEN_KEY, refreshToken)
          : deleteSecureItem(REFRESH_TOKEN_KEY),
      ]);
    },
    [],
  );

  useEffect(() => {
    configureNativeRuntime({
      unauthorized: () => {
        void clearAuthentication();
        setPhase("login");
      },
      tokenChanged: (next) => {
        void setSecureItem(TOKEN_KEY, next).catch(() => {});
        updateStoredAccountToken("accessToken", next);
      },
      refreshTokenChanged: (next) => {
        void setSecureItem(REFRESH_TOKEN_KEY, next).catch(() => {});
        updateStoredAccountToken("refreshToken", next);
      },
    });
  }, [clearAuthentication, updateStoredAccountToken]);

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
    async (
      value: string,
      suppliedManifest?: DiscoveryManifest,
      trustReplacement = false,
    ) => {
      pairingGeneration.current += 1;
      setPairing(null);
      const currentGeneration = ++generation.current;
      setError(null);
      setPhase("connecting");
      try {
        const nextOrigin = normalizeOrigin(value);
        const manifest = suppliedManifest
          ? parseDiscoveryManifest(suppliedManifest)
          : await readManifest(nextOrigin);
        const webTarget = embeddedWebClientTarget(
          Platform.OS,
          Platform.OS === "web" ? globalThis.location.origin : "",
          nextOrigin,
        );
        if (webTarget) {
          // Browser credentials are intentionally HttpOnly and same-origin.
          // Continue in the server's embedded web client instead of weakening
          // authentication for the separately hosted Expo bundle.
          globalThis.location.assign(webTarget);
          return true;
        }
        const previousServer = serverIdentity.current;
        const nextIdentity = {
          instanceId: manifest.instanceId,
          origin: nextOrigin,
        };
        if (
          !trustReplacement &&
          savedAddressWasReplaced(previousServer, nextIdentity)
        ) {
          pendingServerReplacement.current = {
            manifest,
            origin: nextOrigin,
          };
          setServerReplacementPending(true);
          setError(SERVER_REPLACEMENT_WARNING);
          setPhase("discovering");
          return false;
        }
        const setup = await getSetupStatus(`${nextOrigin}/api/v1`);
        if (currentGeneration !== generation.current) return false;
        if (serverIdentityChanged(previousServer, nextIdentity)) {
          await clearAuthentication();
          if (currentGeneration !== generation.current) return false;
        }
        pendingServerReplacement.current = null;
        setServerReplacementPending(false);
        configureNativeRuntime({ origin: nextOrigin });
        serverIdentity.current = nextIdentity;
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
        const message =
          cause instanceof Error
            ? cause.message
            : "Could not reach that library.";
        console.error("Could not connect to Parson library", cause);
        setError(message);
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
        savedAccounts,
      ] = await Promise.all([
        getSecureItem(SERVER_KEY),
        getSecureItem(TOKEN_KEY),
        getSecureItem(REFRESH_TOKEN_KEY),
        getSecureItem(INSTANCE_KEY),
        getSecureItem(LIBRARY_KEY),
        getSecureItem(ACCOUNTS_KEY),
      ]);
      if (cancelled) return;
      const accounts = parseStoredAccounts(savedAccounts);
      storedAccountsRef.current = accounts;
      setStoredAccounts(accounts);
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
        if (
          !(await connect(savedOrigin)) &&
          !cancelled &&
          !pendingServerReplacement.current
        )
          setPhase("offline");
        return;
      }
      for (let attempt = 0; attempt < 8 && !cancelled; attempt += 1) {
        if (await connect(savedOrigin)) return;
        if (pendingServerReplacement.current) return;
        if (attempt < 7)
          await new Promise((resolve) => setTimeout(resolve, 750));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connect]);

  useEffect(() => {
    if (
      Platform.OS === "web" ||
      !claims ||
      !origin ||
      !instanceId ||
      phase !== "ready"
    )
      return;
    activeAccountRef.current = { instanceId, sub: claims.sub };
    let active = true;
    void Promise.all([
      getSecureItem(TOKEN_KEY),
      getSecureItem(REFRESH_TOKEN_KEY),
    ]).then(([accessToken, refreshToken]) => {
      if (!active || !accessToken) return;
      replaceStoredAccounts(
        upsertStoredAccount(storedAccountsRef.current, {
          accessToken,
          instanceId,
          origin,
          refreshToken,
          sub: claims.sub,
          username: claims.username,
        }),
      );
    });
    return () => {
      active = false;
    };
  }, [claims, instanceId, origin, phase, replaceStoredAccounts]);

  const confirmServerReplacement = useCallback(async () => {
    const pending = pendingServerReplacement.current;
    if (!pending) return false;
    pendingServerReplacement.current = null;
    setServerReplacementPending(false);
    setError(null);
    return connect(pending.origin, pending.manifest, true);
  }, [connect]);

  const cancelServerReplacement = useCallback(() => {
    generation.current += 1;
    pendingServerReplacement.current = null;
    setServerReplacementPending(false);
    setError(null);
    setPhase("discovering");
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      if (userOperationInFlight.current) return false;
      pairingGeneration.current += 1;
      setPairing(null);
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
        if (
          !response.status ||
          (Platform.OS !== "web" && !response.access_token)
        ) {
          setError(response.message || "Sign in failed.");
          setPhase("login");
          return false;
        }
        if (Platform.OS !== "web") {
          await storeNativeAuthentication(
            response.access_token ?? "",
            response.refresh_token,
          );
        }
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
    },
    [storeNativeAuthentication],
  );

  const cancelPairing = useCallback(() => {
    pairingGeneration.current += 1;
    setPairing(null);
    setError(null);
  }, []);

  const switchAccount = useCallback(
    async (key: string) => {
      const account = storedAccountsRef.current.find(
        (item) =>
          accountKey(item) === key &&
          item.instanceId === instanceId &&
          item.origin === origin,
      );
      if (!account || userOperationInFlight.current) return false;
      userOperationInFlight.current = true;
      pairingGeneration.current += 1;
      setPairing(null);
      setError(null);
      setPhase("connecting");
      const expectedGeneration = generation.current;
      try {
        await storeNativeAuthentication(
          account.accessToken,
          account.refreshToken,
        );
        activeAccountRef.current = {
          instanceId: account.instanceId,
          sub: account.sub,
        };
        const session = await isValid();
        if (expectedGeneration !== generation.current) return false;
        if (!session.status || !session.claims) {
          setError(
            "This saved account has expired. Pair it again to continue.",
          );
          setPhase("login");
          return false;
        }
        setClaims(session.claims);
        setPhase("ready");
        setTimeout(() => queryClient.clear(), 0);
        return true;
      } catch (cause) {
        if (expectedGeneration !== generation.current) return false;
        setError(
          cause instanceof Error ? cause.message : "Could not switch accounts.",
        );
        setPhase("login");
        return false;
      } finally {
        userOperationInFlight.current = false;
      }
    },
    [instanceId, origin, queryClient, storeNativeAuthentication],
  );

  const startPairing = useCallback(async () => {
    if (Platform.OS === "web") return;
    const expectedSession = generation.current;
    const expectedPairing = ++pairingGeneration.current;
    setError(null);
    setPairing(null);
    try {
      const request = await startDevicePairing(
        Device.deviceName?.trim() ||
          Device.modelName?.trim() ||
          "Android device",
      );
      if (
        expectedSession !== generation.current ||
        expectedPairing !== pairingGeneration.current
      )
        return;
      const expiresAt = Date.now() + request.expiresIn * 1_000;
      setPairing({ code: request.code, expiresAt });
      while (
        expectedSession === generation.current &&
        expectedPairing === pairingGeneration.current &&
        Date.now() < expiresAt
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        if (
          expectedSession !== generation.current ||
          expectedPairing !== pairingGeneration.current
        )
          return;
        const response = await checkDevicePairing(
          request.pairingId,
          request.secret,
        );
        if (response.status && response.access_token) {
          await storeNativeAuthentication(
            response.access_token,
            response.refresh_token,
          );
          if (
            expectedSession !== generation.current ||
            expectedPairing !== pairingGeneration.current
          )
            return;
          const session = response.claims
            ? { status: true, claims: response.claims }
            : await isValid();
          if (!session.status || !session.claims) {
            throw new Error("The paired session could not be verified.");
          }
          setClaims(session.claims);
          setPairing(null);
          setPhase("ready");
          return;
        }
        if (response.expired) break;
      }
      if (
        expectedSession === generation.current &&
        expectedPairing === pairingGeneration.current
      ) {
        setPairing(null);
        setError("That pairing code expired. Request a new code to try again.");
      }
    } catch (cause) {
      if (
        expectedSession !== generation.current ||
        expectedPairing !== pairingGeneration.current
      )
        return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start device pairing.",
      );
    }
  }, [storeNativeAuthentication]);

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
        if (
          !signedIn.status ||
          (Platform.OS !== "web" && !signedIn.access_token)
        ) {
          setError(signedIn.message || "Account created. Sign in to continue.");
          setPhase("login");
          return false;
        }
        if (Platform.OS !== "web") {
          await storeNativeAuthentication(
            signedIn.access_token ?? "",
            signedIn.refresh_token,
          );
        }
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
    [resolveSetup, storeNativeAuthentication],
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
    pairingGeneration.current += 1;
    setPairing(null);
    try {
      await logoutRequest();
    } catch {
      // Local logout must still succeed while the server is unavailable.
    }
    const active = activeAccountRef.current;
    if (active) {
      replaceStoredAccounts(
        storedAccountsRef.current.filter(
          (account) =>
            !(
              account.instanceId === active.instanceId &&
              account.sub === active.sub
            ),
        ),
      );
    }
    activeAccountRef.current = null;
    await clearAuthentication();
    setPhase("login");
    // Let the authenticated route tree unmount before notifying every query
    // observer. Clearing synchronously while Expo Router is redirecting can
    // cause nested observer updates on web.
    setTimeout(() => queryClient.clear(), 0);
  }, [clearAuthentication, queryClient, replaceStoredAccounts]);

  const updateBitrate = useCallback((bitrate: number) => {
    setClaims((value) => (value ? { ...value, bitrate } : value));
  }, []);

  const changeUsername = useCallback(
    async (username: string, currentPassword: string) => {
      if (userOperationInFlight.current) return false;
      userOperationInFlight.current = true;
      const expectedGeneration = generation.current;
      setError(null);
      try {
        const response = await changeUsernameRequest(
          username.trim(),
          currentPassword,
          { native: Platform.OS !== "web" },
        );
        if (
          expectedGeneration !== generation.current ||
          !response.status ||
          !response.claims
        )
          return false;
        if (Platform.OS !== "web") {
          if (!response.access_token) return false;
          configureNativeRuntime({ token: response.access_token });
          await setSecureItem(TOKEN_KEY, response.access_token);
          updateStoredAccountToken("accessToken", response.access_token);
        }
        if (expectedGeneration !== generation.current) return false;
        const activeAccount = activeAccountRef.current;
        if (activeAccount) {
          replaceStoredAccounts(
            renameStoredAccount(
              storedAccountsRef.current,
              activeAccount.instanceId,
              activeAccount.sub,
              response.claims.username,
            ),
          );
        }
        setClaims(response.claims);
        void queryClient.invalidateQueries({ queryKey: ["settings-users"] });
        return true;
      } catch (cause) {
        if (expectedGeneration === generation.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not update the username.",
          );
        }
        return false;
      } finally {
        userOperationInFlight.current = false;
      }
    },
    [queryClient, replaceStoredAccounts, updateStoredAccountToken],
  );

  const changeServer = useCallback(async () => {
    generation.current += 1;
    pairingGeneration.current += 1;
    setPairing(null);
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
    pendingServerReplacement.current = null;
    setServerReplacementPending(false);
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
      pairing,
      savedAccounts: storedAccounts
        .filter(
          (account) =>
            account.instanceId === instanceId && account.origin === origin,
        )
        .map((account) => ({
          current: account.sub === claims?.sub,
          key: accountKey(account),
          username: account.username,
        })),
      phase,
      setupStatus,
      cancelPairing,
      cancelServerReplacement,
      changeServer,
      changeUsername,
      confirmServerReplacement,
      connect,
      login,
      logout,
      retry,
      startPairing,
      switchAccount,
      updateBitrate,
      setupAccount,
      setupLibrary,
      serverReplacementPending,
    }),
    [
      cancelPairing,
      cancelServerReplacement,
      changeServer,
      changeUsername,
      claims,
      confirmServerReplacement,
      connect,
      error,
      instanceId,
      libraryName,
      login,
      logout,
      origin,
      pairing,
      phase,
      retry,
      startPairing,
      storedAccounts,
      switchAccount,
      updateBitrate,
      setupAccount,
      setupLibrary,
      setupStatus,
      serverReplacementPending,
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
