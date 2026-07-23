import api, { isApiError } from "../core/http";
import type { SessionResponse } from "./auth";

export interface LibraryCatalogAlbum {
  id: string;
  name: string;
  artistId: string;
  artistName: string;
  coverPath: string;
  releaseYear: string;
  songCount: number;
  firstSongId?: string | null;
}

export interface LibraryCatalogSong {
  id: string;
  name: string;
  artistId: string;
  artistName: string;
  albumId: string;
  albumName: string;
  coverPath: string;
  path: string;
  durationSeconds: number;
}

export interface LibraryCatalogArtist {
  id: string;
  name: string;
  artworkPath: string;
  albumCount: number;
  songCount: number;
}

export interface LibraryCatalogPage {
  albums: LibraryCatalogAlbum[];
  songs: LibraryCatalogSong[];
  totalAlbums: number;
  totalSongs: number;
}

export type LibraryReadinessState =
  "no_library_indexed" | "indexing" | "failed" | "ready";

export interface LibraryReadiness {
  state: LibraryReadinessState;
  message?: string | null;
  enrichment: "pending" | "running" | "complete" | "failed";
  catalog_revision: number;
  setup_required: boolean;
}

export interface LibraryUnavailableResponse extends LibraryReadiness {
  error:
    | "library_setup_required"
    | "library_indexing"
    | "library_index_failed"
    | "library_cache_unavailable"
    | LibraryReadinessState;
}

export interface LibraryIndexWarning {
  path: string;
  message: string;
}

export interface LibraryIndexReport {
  scanned_files: number;
  indexed_files: number;
  skipped_files: number;
  warnings: LibraryIndexWarning[];
}

export interface LibraryIndexResponse<TLibrary = unknown> {
  library: TLibrary | null;
  report: LibraryIndexReport;
}

export interface LibraryRefreshResult {
  refreshed: Array<{ path: string; report: LibraryIndexReport }>;
  failures: Array<{ path: string; message: string }>;
}

export interface LibraryRoot {
  path: string;
}

export interface SetupStatus {
  server_ready: boolean;
  setup_required: boolean;
  account_setup_required: boolean;
  library_setup_required: boolean;
  library_state: LibraryReadinessState;
  message?: string | null;
  authenticated_admin: boolean;
  authenticated: boolean;
  session?: SessionResponse["claims"] | null;
  suggested_library_path: string;
}

export interface LibrarySuggestion {
  label: string;
  path: string;
  track_count: number;
  count_is_limited: boolean;
}

export interface DiscoveredServer {
  instanceId: string;
  name: string;
  origin: string;
  port: number;
  isCurrent: boolean;
}

function isLibraryReadinessState(
  value: unknown,
): value is LibraryReadinessState {
  return (
    value === "no_library_indexed" ||
    value === "indexing" ||
    value === "failed" ||
    value === "ready"
  );
}

export function getLibraryUnavailable(error: unknown): LibraryReadiness | null {
  if (!isApiError(error)) return null;

  const data = error.response?.data as
    Partial<LibraryUnavailableResponse> | undefined;
  if (!data) return null;

  if (!isLibraryReadinessState(data.state)) return null;

  return {
    state: data.state,
    message: data.message ?? null,
    enrichment:
      data.enrichment === "running" ||
      data.enrichment === "complete" ||
      data.enrichment === "failed"
        ? data.enrichment
        : "pending",
    catalog_revision:
      typeof data.catalog_revision === "number" ? data.catalog_revision : 0,
    setup_required: data.setup_required === true,
  };
}

export async function getLibraryReadiness(): Promise<LibraryReadiness> {
  const response = await api.get<LibraryReadiness>("/library/status");
  return response.data;
}

export async function getLibraryRoots(): Promise<LibraryRoot[]> {
  const response = await api.get<LibraryRoot[]>("/library/roots");
  return Array.isArray(response.data) ? response.data : [];
}

export async function removeLibraryRoot(path: string): Promise<LibraryRoot[]> {
  const response = await api.delete<LibraryRoot[]>("/library/roots", {
    params: { path },
  });
  return Array.isArray(response.data) ? response.data : [];
}

export async function getSetupStatus(baseURL?: string): Promise<SetupStatus> {
  const response = await api.get<SetupStatus>("/setup/status", {
    baseURL,
    skipAuth: Boolean(baseURL),
  });
  return response.data;
}

export async function getLibrarySuggestions(): Promise<LibrarySuggestion[]> {
  const response = await api.get<LibrarySuggestion[]>("/setup/suggestions", {
    timeout: 4_000,
  });
  return Array.isArray(response.data) ? response.data : [];
}

export async function discoverNearbyServers(): Promise<DiscoveredServer[]> {
  const response = await api.get<DiscoveredServer[]>("/discovery/nearby", {
    timeout: 4_000,
  });
  if (!Array.isArray(response.data)) return [];
  return response.data.filter(
    (server): server is DiscoveredServer =>
      server !== null &&
      typeof server === "object" &&
      typeof server.instanceId === "string" &&
      server.instanceId.length > 0 &&
      typeof server.name === "string" &&
      typeof server.origin === "string" &&
      typeof server.isCurrent === "boolean" &&
      Number.isInteger(server.port) &&
      server.port > 0 &&
      server.port <= 65_535,
  );
}

export async function getLibraryCatalog(
  offset = 0,
  limit = 50,
  section?: "albums" | "songs",
): Promise<LibraryCatalogPage> {
  const response = await api.get<LibraryCatalogPage>("/library/catalog", {
    params: { offset, limit, section },
  });
  return response.data;
}

export async function getLibraryCatalogArtists(
  offset = 0,
  limit = 50,
): Promise<LibraryCatalogArtist[]> {
  const response = await api.get<LibraryCatalogArtist[]>(
    "/library/catalog/artists",
    { params: { offset, limit } },
  );
  if (!Array.isArray(response.data)) return [];

  return response.data.filter(
    (artist): artist is LibraryCatalogArtist =>
      artist !== null &&
      typeof artist === "object" &&
      typeof artist.id === "string" &&
      artist.id.length > 0 &&
      typeof artist.name === "string",
  );
}

export async function indexLibrary(
  pathToLibrary: string,
): Promise<LibraryIndexResponse> {
  const response = await api.post(
    `/library`,
    {
      path: pathToLibrary,
    },
    {
      timeout: 30 * 60 * 1000,
    },
  );
  return response.data;
}

export async function indexSetupLibrary(
  pathToLibrary: string,
): Promise<LibraryIndexResponse> {
  const response = await api.post(
    `/setup/library`,
    { path: pathToLibrary },
    { timeout: 30 * 60 * 1000 },
  );
  return response.data;
}

export async function refreshCurrentLibrary(): Promise<LibraryRefreshResult> {
  const response = await api.post<LibraryRefreshResult>(
    "/library/refresh",
    undefined,
    {
      timeout: 30 * 60 * 1000,
    },
  );
  return response.data;
}
