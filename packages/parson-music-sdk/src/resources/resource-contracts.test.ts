import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import api, { ApiError } from "../core/http";
import { clearCachedAlbumInfos, getAlbumInfo, getAlbumInfos } from "./albums";
import {
  clearCachedArtistInfos,
  getArtistInfo,
  getArtistInfos,
} from "./artists";
import {
  discoverNearbyServers,
  getLibrarySuggestions,
  getLibraryUnavailable,
} from "./library";
import { findLyrics, getCachedLyrics } from "./lyrics";
import {
  addAlbumToPlaylist,
  addSongsToPlaylist,
  createPlaylist,
  removeSongFromPlaylist,
} from "./playlists";
import {
  editAlbumMetadata,
  editLibraryMetadata,
  clearCachedSongInfos,
  getSongInfo,
  getSongInfos,
  uploadAlbumCover,
} from "./songs";
import { isFavoriteSong } from "./users";

afterEach(() => {
  mock.restore();
});

test("favorite membership checks are bounded for embedded clients", async () => {
  const get = spyOn(api, "get").mockResolvedValue({
    data: { liked: true },
    status: 200,
    headers: new Headers(),
  } as never);

  expect(await isFavoriteSong("folder/song #1")).toBeTrue();
  expect(get).toHaveBeenCalledWith("/users/me/favorites/folder%2Fsong%20%231", {
    timeout: 4_000,
  });
});

test("catalog cache invalidation forces entity metadata to refresh", async () => {
  const get = spyOn(api, "get").mockImplementation(async (path) => {
    if (path === "/albums/cache-refresh") {
      return { data: { Bare: { id: "cache-refresh" } } } as never;
    }
    if (path === "/artists/cache-refresh") {
      return { data: { id: "cache-refresh" } } as never;
    }
    return { data: { Bare: { id: "cache-refresh" } } } as never;
  });

  await getAlbumInfo("cache-refresh");
  await getArtistInfo("cache-refresh");
  await getSongInfo("cache-refresh");
  clearCachedAlbumInfos();
  clearCachedArtistInfos();
  clearCachedSongInfos();
  await getAlbumInfo("cache-refresh");
  await getArtistInfo("cache-refresh");
  await getSongInfo("cache-refresh");

  expect(get).toHaveBeenCalledTimes(6);
});

test("folder suggestions use the bounded setup endpoint", async () => {
  const suggestions = [
    {
      label: "Music",
      path: "/home/listener/Music",
      track_count: 42,
      count_is_limited: false,
    },
  ];
  const get = spyOn(api, "get").mockResolvedValue({
    data: suggestions,
    status: 200,
    headers: new Headers(),
  } as never);

  expect(await getLibrarySuggestions()).toEqual(suggestions);
  expect(get).toHaveBeenCalledWith("/setup/suggestions", { timeout: 4_000 });
});

test("nearby server discovery is public, bounded, and validated", async () => {
  const servers = [
    {
      instanceId: "living-room",
      name: "Living room",
      origin: "http://192.168.1.20:1993",
      port: 1993,
      isCurrent: false,
    },
  ];
  const get = spyOn(api, "get").mockResolvedValue({
    data: [...servers, { name: "invalid" }],
    status: 200,
    headers: new Headers(),
  } as never);

  expect(await discoverNearbyServers()).toEqual(servers);
  expect(get).toHaveBeenCalledWith("/discovery/nearby", { timeout: 4_000 });
});

describe("cached entity resources", () => {
  test("concurrent and repeated lyrics lookups share one request", async () => {
    const get = spyOn(api, "get").mockResolvedValue({
      data: { id: 1, trackName: "Cached lyrics" },
      status: 200,
      headers: new Headers(),
    } as never);
    const [first, second] = await Promise.all([
      findLyrics("lyrics-single-flight"),
      findLyrics("lyrics-single-flight"),
    ]);
    expect(first).toBe(second);
    await findLyrics("lyrics-single-flight");
    expect(get).toHaveBeenCalledTimes(1);
    expect(getCachedLyrics("lyrics-single-flight")).toBe(first);
  });

  test("concurrent album lookups share a request and keep bare/full caches separate", async () => {
    const get = spyOn(api, "get").mockImplementation(
      async (_path, config) =>
        ({
          data: (config?.params as { bare?: boolean } | undefined)?.bare
            ? { Bare: { id: "album-concurrent" } }
            : {
                Full: {
                  id: "album-concurrent",
                  artist_object: { id: "artist" },
                },
              },
          status: 200,
          headers: new Headers(),
        }) as never,
    );
    const first = getAlbumInfo("album-concurrent", true);
    const second = getAlbumInfo("album-concurrent", true);
    expect(await first).toBe(await second);
    expect(get).toHaveBeenCalledTimes(1);
    await getAlbumInfo("album-concurrent", false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("album batches deduplicate IDs, skip blanks, and reuse cached values", async () => {
    const post = spyOn(api, "post").mockResolvedValue({
      data: { "album-batch": { Bare: { id: "album-batch" } } },
      status: 200,
      headers: new Headers(),
    } as never);
    const first = await getAlbumInfos(["", "album-batch", "album-batch"], true);
    expect(first["album-batch"]?.id).toBe("album-batch");
    expect(post).toHaveBeenCalledWith("/albums/batch", {
      ids: ["album-batch"],
      bare: true,
    });
    await getAlbumInfos(["album-batch"], true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("entity batches split at backend limits instead of silently dropping IDs", async () => {
    const post = spyOn(api, "post").mockResolvedValue({
      data: {},
      status: 200,
      headers: new Headers(),
    } as never);
    const ids = Array.from(
      { length: 501 },
      (_, index) => `album-limit-${index}`,
    );
    await getAlbumInfos(ids, true);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[1]).toEqual({
      ids: ids.slice(0, 500),
      bare: true,
    });
    expect(post.mock.calls[1]?.[1]).toEqual({
      ids: ids.slice(500),
      bare: true,
    });
  });

  test("artist requests are single-flight and batches deduplicate IDs", async () => {
    const get = spyOn(api, "get").mockResolvedValue({
      data: { id: "artist-concurrent" },
      status: 200,
      headers: new Headers(),
    } as never);
    const [first, second] = await Promise.all([
      getArtistInfo("artist-concurrent"),
      getArtistInfo("artist-concurrent"),
    ]);
    expect(first).toBe(second);
    expect(get).toHaveBeenCalledTimes(1);

    const post = spyOn(api, "post").mockResolvedValue({
      data: { "artist-batch": { id: "artist-batch" } },
      status: 200,
      headers: new Headers(),
    } as never);
    await getArtistInfos(["artist-batch", "", "artist-batch"]);
    expect(post).toHaveBeenCalledWith("/artists/batch", {
      ids: ["artist-batch"],
    });
  });

  test("song resources reject malformed envelopes and invalidate both caches after edits", async () => {
    const get = spyOn(api, "get").mockResolvedValue({
      data: {},
      status: 200,
      headers: new Headers(),
    } as never);
    await expect(getSongInfo("malformed-song", true)).rejects.toThrow(
      "Unexpected response format",
    );
    get.mockResolvedValue({
      data: { Bare: { id: "edited-song" } },
      status: 200,
      headers: new Headers(),
    } as never);
    await getSongInfo("edited-song", true);
    const post = spyOn(api, "post").mockResolvedValue({
      data: {},
      status: 200,
      headers: new Headers(),
    } as never);
    await editLibraryMetadata("edited-song", { song: { name: "Edited" } });
    await getSongInfo("edited-song", true);
    expect(get).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenCalledWith("/metadata/song/edited-song", {
      song: { name: "Edited" },
    });

    post.mockResolvedValueOnce({
      data: {
        album: {
          id: "edited-album",
          name: "Edited album",
          artist_object: { id: "edited-artist", name: "Edited artist" },
        },
        artist: { id: "edited-artist", name: "Edited artist" },
      },
      status: 200,
      headers: new Headers(),
    } as never);
    await editAlbumMetadata("edited-album", {
      album: { name: "Edited album" },
    });
    expect(post).toHaveBeenCalledWith("/metadata/album/edited-album", {
      album: { name: "Edited album" },
    });
    expect((await getAlbumInfo("edited-album", false)).name).toBe(
      "Edited album",
    );
    expect((await getArtistInfo("edited-artist")).name).toBe("Edited artist");
    expect(get).toHaveBeenCalledTimes(3);
  });

  test("song batches filter duplicate and empty identifiers", async () => {
    const post = spyOn(api, "post").mockResolvedValue({
      data: { s1: { Bare: { id: "s1" } } },
      status: 200,
      headers: new Headers(),
    } as never);
    expect(await getSongInfos(["s1", "", "s1"], true)).toHaveProperty(
      "s1.id",
      "s1",
    );
    expect(post).toHaveBeenCalledWith("/songs/batch", {
      ids: ["s1"],
      bare: true,
    });
  });

  test("album cover uploads use multipart form data", async () => {
    const put = spyOn(api, "put").mockResolvedValue({
      data: { cover_url: "Album Covers/uploaded.jpg" },
      status: 200,
      headers: new Headers(),
    } as never);
    const cover = new File(["cover"], "cover.png", { type: "image/png" });

    expect(await uploadAlbumCover("album/one", cover)).toBe(
      "Album Covers/uploaded.jpg",
    );
    const [path, form] = put.mock.calls[0]!;
    expect(path).toBe("/metadata/album/album%2Fone/cover");
    expect(form).toBeInstanceOf(FormData);
    const uploaded = (form as FormData).get("cover") as File;
    expect(uploaded.name).toBe("cover.png");
    expect(uploaded.type).toBe("image/png");
    expect(uploaded.size).toBe(cover.size);
  });

  test("song batches reuse matching in-flight single lookups", async () => {
    let resolveGet!: (value: unknown) => void;
    const get = spyOn(api, "get").mockImplementation(
      () => new Promise((resolve) => (resolveGet = resolve)) as never,
    );
    const post = spyOn(api, "post");
    const single = getSongInfo("song-in-flight", false);
    const batch = getSongInfos(["song-in-flight"], false);
    resolveGet({
      data: { Full: { id: "song-in-flight" } },
      status: 200,
      headers: new Headers(),
    });
    expect((await batch)["song-in-flight"]?.id).toBe("song-in-flight");
    await single;
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});

test("playlist path identifiers are URL encoded", async () => {
  const remove = spyOn(api, "delete").mockResolvedValue({
    data: undefined,
    status: 204,
    headers: new Headers(),
  } as never);
  await removeSongFromPlaylist(7, "folder/song ?#1");
  expect(remove).toHaveBeenCalledWith(
    "/playlists/7/tracks/folder%2Fsong%20%3F%231",
  );
});

test("playlist batch adds deduplicate tracks into one request", async () => {
  const post = spyOn(api, "post").mockResolvedValue({
    data: undefined,
    status: 204,
    headers: new Headers(),
  } as never);
  await addSongsToPlaylist(7, ["song-1", "", "song-1", "song-2"]);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith("/playlists/7/tracks/batch", {
    song_ids: ["song-1", "song-2"],
  });
});

test("album playlist actions use one server-expanded request", async () => {
  const post = spyOn(api, "post").mockResolvedValue({
    data: undefined,
    status: 204,
    headers: new Headers(),
  } as never);
  await addAlbumToPlaylist(7, "album/favorite");
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith("/playlists/7/albums/album%2Ffavorite");
});

test("playlist creation sends initial tracks or album in the create request", async () => {
  const post = spyOn(api, "post").mockResolvedValue({
    data: { id: 1, name: "Mix" },
    status: 201,
    headers: new Headers(),
  } as never);
  await createPlaylist("Mix", ["song-1", "song-1"], "album-1");
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith("/playlists", {
    name: "Mix",
    song_ids: ["song-1"],
    album_id: "album-1",
  });
});

test("playlist batch adds split oversized inputs into bounded requests", async () => {
  const post = spyOn(api, "post").mockResolvedValue({
    data: undefined,
    status: 204,
    headers: new Headers(),
  } as never);
  const ids = Array.from({ length: 501 }, (_, index) => `song-${index}`);
  await addSongsToPlaylist(9, ids);
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[0]?.[1]).toEqual({ song_ids: ids.slice(0, 500) });
  expect(post.mock.calls[1]?.[1]).toEqual({ song_ids: ids.slice(500) });
});

test("library readiness extraction accepts only validated API error states", () => {
  const response = {
    status: 503,
    headers: new Headers(),
    data: { state: "indexing", message: "Scanning", setup_required: false },
  };
  expect(getLibraryUnavailable(new ApiError("busy", {}, response))).toEqual({
    state: "indexing",
    message: "Scanning",
    enrichment: "pending",
    catalog_revision: 0,
    setup_required: false,
  });
  expect(
    getLibraryUnavailable(
      new ApiError("bad", {}, { ...response, data: { state: "surprise" } }),
    ),
  ).toBeNull();
  expect(getLibraryUnavailable(new Error("offline"))).toBeNull();
});
