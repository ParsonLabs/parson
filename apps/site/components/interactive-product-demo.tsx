"use client";

import {
  AudioLines,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Disc3,
  Ellipsis,
  FolderOpen,
  Heart,
  Home,
  Library,
  ListMusic,
  MicVocal,
  Minus,
  Music2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import sitePackage from "../package.json";
import Image from "next/image";

type Album = {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  type: string;
  year: string;
};

const albums: Album[] = [
  {
    id: "afterlight",
    title: "Afterlight",
    artist: "Mira Sol",
    artwork: "/album-art/afterlight.webp",
    type: "Album",
    year: "2026",
  },
  {
    id: "night-swim",
    title: "Night Swim",
    artist: "Mira Sol",
    artwork: "/album-art/night-swim.webp",
    type: "Album",
    year: "2025",
  },
  {
    id: "amber-hours",
    title: "Amber Hours",
    artist: "North Arcade",
    artwork: "/album-art/amber-hours.webp",
    type: "Album",
    year: "2026",
  },
  {
    id: "evergreen",
    title: "Evergreen",
    artist: "Mira Sol",
    artwork: "/album-art/evergreen.webp",
    type: "Edition",
    year: "2024",
  },
  {
    id: "still-form",
    title: "Still Form",
    artist: "Mira Sol",
    artwork: "/album-art/still-form.webp",
    type: "Single",
    year: "2026",
  },
  {
    id: "red-shift",
    title: "Red Shift",
    artist: "Mira Sol",
    artwork: "/album-art/red-shift.webp",
    type: "Remix",
    year: "2025",
  },
  {
    id: "violet-river",
    title: "Violet River",
    artist: "Mira Sol",
    artwork: "/album-art/violet-river.webp",
    type: "Live",
    year: "2023",
  },
  {
    id: "distant-lines",
    title: "Distant Lines",
    artist: "North Arcade",
    artwork: "/album-art/distant-lines.webp",
    type: "Album",
    year: "2024",
  },
  {
    id: "golden-state",
    title: "Golden State",
    artist: "Mira Sol",
    artwork: "/album-art/golden-state.webp",
    type: "Bootleg",
    year: "2022",
  },
];

const tracks = [
  ["First Light", "3:42", 222],
  ["A Little Further", "4:08", 248],
  ["Open Water", "3:19", 199],
  ["Quiet Signals", "4:31", 271],
  ["Into the Blue", "3:56", 236],
  ["Northern Lines", "3:28", 208],
  ["Weightless", "4:12", 252],
  ["Signal Fires", "3:47", 227],
  ["Homeward", "5:02", 302],
] as const;

const demoSongAlbums = [
  albums[0],
  albums[1],
  albums[3],
  albums[2],
  albums[4],
  albums[5],
  albums[6],
  albums[8],
  albums[7],
];

type Playlist = {
  id: string;
  name: string;
  description?: string;
  album: Album;
  trackIndexes: number[];
  liked?: boolean;
};

const playlists: Playlist[] = [
  {
    id: "liked",
    name: "Liked Songs",
    album: albums[0],
    trackIndexes: [0, 2, 4, 6, 8],
    liked: true,
  },
  {
    id: "late-night-drives",
    name: "Late Night Drives",
    description: "Quiet roads, city lights, and the long way home.",
    album: albums[1],
    trackIndexes: [1, 2, 3, 5, 7, 8],
  },
  {
    id: "weekend-listening",
    name: "Weekend Listening",
    description: "An easy mix for slow mornings and open windows.",
    album: albums[2],
    trackIndexes: [0, 1, 4, 5, 6],
  },
];

type LibrarySection = "albums" | "songs" | "artists" | "playlists";

const lyricTimes = [0, 18, 36, 54, 72, 90, 108, 126, 144, 162, 180, 200];

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

type View =
  | { name: "home" }
  | { name: "library" }
  | { name: "settings" }
  | { name: "artist"; artist: string }
  | { name: "album"; album: Album }
  | { name: "playlist"; playlist: Playlist };

function BrandMark() {
  return (
    <Image
      className="demo-brand-mark"
      src="/icons/icon.svg"
      aria-hidden="true"
      alt=""
      width={64}
      height={64}
      draggable={false}
    />
  );
}

type InteractiveProductDemoProps = {
  capture?: boolean;
  initialAlbumId?: string;
  initialPanel?: "lyrics" | "queue" | "fullscreen";
  initialPlaying?: boolean;
  initialQuery?: string;
  initialTime?: number;
  initialTrackIndex?: number;
  initialView?:
    "album" | "artist" | "home" | "library" | "playlist" | "settings";
};

function initialDemoView(
  name: NonNullable<InteractiveProductDemoProps["initialView"]>,
  album: Album,
): View {
  switch (name) {
    case "album":
      return { name, album };
    case "artist":
      return { name, artist: album.artist };
    case "playlist":
      return { name, playlist: playlists[1] };
    default:
      return { name };
  }
}

export default function InteractiveProductDemo({
  capture = false,
  initialAlbumId = "afterlight",
  initialPanel,
  initialPlaying = false,
  initialQuery = "",
  initialTime = 42,
  initialTrackIndex = 0,
  initialView = "home",
}: InteractiveProductDemoProps = {}) {
  const initialAlbum =
    albums.find((album) => album.id === initialAlbumId) ?? albums[0];
  const safeInitialTrackIndex = Math.max(
    0,
    Math.min(initialTrackIndex, tracks.length - 1),
  );
  const [view, setView] = useState<View>(
    initialDemoView(initialView, initialAlbum),
  );
  const [librarySection, setLibrarySection] =
    useState<LibrarySection>("albums");
  const [query, setQuery] = useState(initialQuery);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [playing, setPlaying] = useState(initialPlaying);
  const [currentAlbum, setCurrentAlbum] = useState(initialAlbum);
  const [lyricsOpen, setLyricsOpen] = useState(initialPanel === "lyrics");
  const [queueOpen, setQueueOpen] = useState(initialPanel === "queue");
  const [fullscreen, setFullscreen] = useState(initialPanel === "fullscreen");
  const [volume, setVolume] = useState(100);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(
    safeInitialTrackIndex,
  );
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [liked, setLiked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showMacWindowControls, setShowMacWindowControls] = useState(false);
  const [ready, setReady] = useState(false);
  const trackDuration = tracks[currentTrackIndex][2];

  useEffect(() => {
    const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
    setShowMacWindowControls(/macintosh|mac os|macintel/.test(source));
    setReady(true);
  }, []);

  const closePanels = () => {
    setLyricsOpen(false);
    setQueueOpen(false);
    setFullscreen(false);
  };
  const goHome = () => {
    closePanels();
    setQuery("");
    setSearchQuery("");
    setView({ name: "home" });
  };
  const openLibrary = (section: LibrarySection = "albums") => {
    closePanels();
    setQuery("");
    setSearchQuery("");
    setLibrarySection(section);
    setView({ name: "library" });
  };
  const openSettings = () => {
    closePanels();
    setQuery("");
    setSearchQuery("");
    setView({ name: "settings" });
  };
  const openArtist = (artist = "Mira Sol") => {
    closePanels();
    setQuery("");
    setSearchQuery("");
    setView({ name: "artist", artist });
  };
  const openAlbum = (album: Album) => {
    closePanels();
    setQuery("");
    setSearchQuery("");
    setView({ name: "album", album });
  };
  const openPlaylist = (playlist: Playlist) => {
    closePanels();
    setQuery("");
    setSearchQuery("");
    setView({ name: "playlist", playlist });
  };
  const playAlbum = (album: Album) => {
    setCurrentAlbum(album);
    setCurrentTrackIndex(0);
    setCurrentTime(0);
    setPlaying(true);
  };
  const moveTrack = (direction: number) => {
    setCurrentTrackIndex(
      (index) => (index + direction + tracks.length) % tracks.length,
    );
    setCurrentTime(0);
    setPlaying(true);
  };
  const playTrack = (album: Album, index: number) => {
    setCurrentAlbum(album);
    setCurrentTrackIndex(index);
    setCurrentTime(0);
    setPlaying(true);
  };

  const activeLyric = useMemo(() => {
    let active = 0;
    lyricTimes.forEach((time, index) => {
      if (time <= currentTime) {
        active = index;
      }
    });
    return active;
  }, [currentTime]);

  useEffect(() => {
    const closeLyrics = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (lyricsOpen || queueOpen) {
        setLyricsOpen(false);
        setQueueOpen(false);
      } else {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", closeLyrics);
    return () => window.removeEventListener("keydown", closeLyrics);
  }, [lyricsOpen, queueOpen]);

  useEffect(() => {
    if (!playing || capture) {
      return;
    }
    let frame: number;
    let previous = performance.now();
    const advance = (now: number) => {
      const elapsed = (now - previous) / 1000;
      previous = now;
      setCurrentTime((value) =>
        value + elapsed >= trackDuration ? 0 : value + elapsed,
      );
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, currentTrackIndex, currentAlbum.id, capture]);

  useEffect(() => {
    if (!lyricsOpen && !queueOpen) {
      return;
    }
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) {
        return;
      }
      if (target.closest(".demo-player")) {
        return;
      }
      if (
        lyricsOpen &&
        !target.closest(".demo-lyrics") &&
        !target.closest(".demo-lyrics-button")
      ) {
        setLyricsOpen(false);
      }
      if (
        queueOpen &&
        !target.closest(".demo-queue") &&
        !target.closest('[aria-label="Queue"]')
      ) {
        setQueueOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [lyricsOpen, queueOpen]);

  return (
    <div
      className={`demo-app${fullscreen ? " demo-is-fullscreen" : ""}`}
      role="region"
      aria-label="Interactive Parson product demo"
      data-demo-ready={ready}
      data-demo-capture={capture}
    >
      <aside className="demo-sidebar" aria-label="Demo navigation">
        <button
          className="demo-brand-button"
          type="button"
          onClick={goHome}
          title="Parson home"
        >
          <BrandMark />
        </button>
        <nav>
          <button
            className={view.name === "home" && !searchQuery ? "active" : ""}
            type="button"
            onClick={goHome}
            title="Home"
            aria-label="Home"
            aria-current={
              view.name === "home" && !searchQuery ? "page" : undefined
            }
          >
            <Home />
          </button>
          <button
            className={view.name === "library" ? "active" : ""}
            type="button"
            onClick={() => openLibrary()}
            title="Library"
            aria-label="Library"
            aria-current={view.name === "library" ? "page" : undefined}
          >
            <Library />
          </button>
        </nav>
        <button
          className={`demo-settings ${view.name === "settings" ? "active" : ""}`}
          type="button"
          onClick={openSettings}
          title="Settings"
          aria-label="Settings"
          aria-current={view.name === "settings" ? "page" : undefined}
        >
          <Settings />
        </button>
      </aside>

      <header className="demo-titlebar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) {
              closePanels();
              setView({ name: "home" });
              setSearchQuery(query.trim());
            }
          }}
        >
          <Search />
          <input
            aria-label="Search demo library"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What do you want to play?"
          />
          {query && (
            <button type="submit" aria-label="Search">
              <ArrowRight />
            </button>
          )}
        </form>
        {showMacWindowControls ? (
          <div className="demo-window-controls macos" aria-hidden="true">
            <span className="macos-close" />
            <span className="macos-minimize" />
            <span className="macos-fullscreen" />
          </div>
        ) : (
          <div className="demo-window-controls" aria-hidden="true">
            <span>
              <Minus />
            </span>
            <span>
              <Square />
            </span>
            <span>
              <X />
            </span>
          </div>
        )}
      </header>

      <div className="demo-surface">
        {searchQuery.trim() ? (
          <SearchView
            query={searchQuery}
            onAlbum={openAlbum}
            onArtist={openArtist}
            onPlay={playAlbum}
            onTrack={playTrack}
          />
        ) : view.name === "home" ? (
          <HomeView
            onAlbum={openAlbum}
            onArtist={openArtist}
            onPlay={playAlbum}
          />
        ) : view.name === "library" ? (
          <LibraryView
            section={librarySection}
            onSectionChange={setLibrarySection}
            onAlbum={openAlbum}
            onArtist={openArtist}
            onPlay={playAlbum}
            onPlaylist={openPlaylist}
            onTrack={playTrack}
          />
        ) : view.name === "settings" ? (
          <SettingsView />
        ) : view.name === "artist" ? (
          <ArtistView
            artist={view.artist}
            onAlbum={openAlbum}
            onPlay={playAlbum}
          />
        ) : view.name === "album" ? (
          <AlbumView
            album={view.album}
            onArtist={openArtist}
            onPlay={playAlbum}
            activeTrack={
              currentAlbum.id === view.album.id ? currentTrackIndex : undefined
            }
            playing={playing}
            onTrack={(album, index) => {
              if (album.id === currentAlbum.id && index === currentTrackIndex) {
                setPlaying((value) => !value);
              } else {
                playTrack(album, index);
              }
            }}
          />
        ) : (
          <PlaylistView
            playlist={view.playlist}
            onArtist={openArtist}
            onBack={() => openLibrary("playlists")}
            onTrack={playTrack}
          />
        )}
      </div>

      {lyricsOpen && (
        <DemoLyrics
          album={currentAlbum}
          activeLine={activeLyric}
          centerActiveLine={capture || initialPanel === "lyrics"}
          onClose={() => setLyricsOpen(false)}
          onLine={(index) => {
            setCurrentTime(lyricTimes[index]);
            setPlaying(true);
          }}
        />
      )}
      {queueOpen && !lyricsOpen && (
        <DemoQueue
          album={currentAlbum}
          activeTrack={currentTrackIndex}
          onClose={() => setQueueOpen(false)}
          onSelect={(index) => playTrack(demoSongAlbums[index], index)}
        />
      )}

      {fullscreen && !lyricsOpen && !queueOpen && (
        <div className="demo-fullscreen-artwork">
          <img src={currentAlbum.artwork} alt={currentAlbum.title} />
          <h3>{tracks[currentTrackIndex][0]}</h3>
          <button type="button" onClick={() => openArtist(currentAlbum.artist)}>
            {currentAlbum.artist}
          </button>
        </div>
      )}
      {fullscreen && (
        <button
          className="demo-fullscreen-exit"
          aria-label="Exit fullscreen player"
          type="button"
          onClick={() => setFullscreen(false)}
        >
          <Minimize2 />
        </button>
      )}
      <DemoPlayer
        fullscreen={fullscreen}
        onFullscreen={() => setFullscreen(true)}
        volume={volume}
        onVolume={(value) => {
          setVolume(value);
          setMuted(value === 0);
        }}
        onSeek={setCurrentTime}
        album={currentAlbum}
        playing={playing}
        lyricsOpen={lyricsOpen}
        queueOpen={queueOpen}
        liked={liked}
        muted={muted}
        soundEnabled={soundEnabled}
        currentTime={currentTime}
        trackDuration={trackDuration}
        trackTitle={tracks[currentTrackIndex][0]}
        onToggle={() => setPlaying((value) => !value)}
        onPrevious={() => moveTrack(-1)}
        onNext={() => moveTrack(1)}
        onToggleLike={() => setLiked((value) => !value)}
        onToggleLyrics={() => {
          setQueueOpen(false);
          setLyricsOpen((value) => !value);
        }}
        onToggleQueue={() => {
          setLyricsOpen(false);
          setQueueOpen((value) => !value);
        }}
        onToggleMute={() => setMuted((value) => !value)}
        onToggleSound={() => setSoundEnabled((value) => !value)}
        onArtist={openArtist}
        onAlbum={openAlbum}
      />
    </div>
  );
}

function HomeView({ onAlbum, onArtist, onPlay }: DemoActions) {
  return (
    <div className="demo-route demo-home-view">
      <h3>Home</h3>
      <div className="demo-feed">
        <MediaRow
          title="Recently played"
          items={albums.slice(0, 5)}
          onAlbum={onAlbum}
          onArtist={onArtist}
          onPlay={onPlay}
        />
        <MediaRow
          title="Recommended songs"
          songs
          items={[albums[4], albums[2], albums[5], albums[1], albums[8]]}
          onAlbum={onAlbum}
          onArtist={onArtist}
          onPlay={onPlay}
        />
        <MediaRow
          title="Albums you might like"
          items={[albums[7], albums[6], albums[3], albums[8], albums[2]]}
          onAlbum={onAlbum}
          onArtist={onArtist}
          onPlay={onPlay}
        />
      </div>
    </div>
  );
}

function LibraryView({
  section,
  onSectionChange,
  onAlbum,
  onArtist,
  onPlay,
  onPlaylist,
  onTrack,
}: DemoActions & {
  section: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  onPlaylist: (playlist: Playlist) => void;
  onTrack: (album: Album, index: number) => void;
}) {
  const artists = [
    { name: "Mira Sol", detail: "7 releases", artwork: albums[0].artwork },
    { name: "North Arcade", detail: "2 albums", artwork: albums[2].artwork },
  ];
  const tabs: Array<{
    id: LibrarySection;
    label: string;
    Icon: typeof Disc3;
  }> = [
    { id: "albums", label: "Albums", Icon: Disc3 },
    { id: "songs", label: "Songs", Icon: Music2 },
    { id: "artists", label: "Artists", Icon: UserRound },
    { id: "playlists", label: "Playlists", Icon: ListMusic },
  ];

  return (
    <div className="demo-route demo-library-view">
      <h3>Library</h3>
      <div className="demo-library-tabs">
        <div role="tablist" aria-label="Library views">
          {tabs.map(({ id, label, Icon }) => (
            <button
              className={section === id ? "active" : ""}
              key={id}
              onClick={() => onSectionChange(id)}
              role="tab"
              aria-selected={section === id}
              type="button"
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
        {section === "playlists" && (
          <button
            className="demo-new-playlist"
            type="button"
            onClick={() => onPlaylist(playlists[1])}
          >
            <Plus /> New playlist
          </button>
        )}
      </div>

      {section === "albums" && (
        <section className="demo-library-albums">
          <div className="demo-search-grid">
            {albums.slice(0, 8).map((album) => (
              <MediaCard
                key={album.id}
                album={album}
                onAlbum={onAlbum}
                onArtist={onArtist}
                onPlay={onPlay}
              />
            ))}
          </div>
        </section>
      )}

      {section === "songs" && (
        <section className="demo-library-songs">
          <ol>
            {tracks.map(([title, duration], index) => {
              const album = demoSongAlbums[index];
              return (
                <li key={title}>
                  <button
                    type="button"
                    onClick={() => onTrack(album, index)}
                    aria-label={`Play ${title}`}
                  >
                    <span>{index + 1}</span>
                    <img src={album.artwork} alt="" />
                    <span>
                      <b>{title}</b>
                      <small>{album.artist}</small>
                    </span>
                    <span>{album.artist}</span>
                    <time>{duration}</time>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {section === "artists" && (
        <section className="demo-library-artists">
          <div>
            {artists.map((artist) => (
              <button
                key={artist.name}
                type="button"
                onClick={() => onArtist(artist.name)}
              >
                <img src={artist.artwork} alt="" />
                <span>
                  <b>{artist.name}</b>
                  <small>{artist.detail}</small>
                </span>
                <ArrowRight />
              </button>
            ))}
          </div>
        </section>
      )}

      {section === "playlists" && (
        <section className="demo-library-playlists">
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              onClick={() => onPlaylist(playlist)}
              aria-label={`Open ${playlist.name}`}
            >
              <PlaylistArtwork playlist={playlist} compact />
              <b>{playlist.name}</b>
              <ChevronRight />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function SettingsView() {
  const [section, setSection] = useState("Account");
  const [saved, setSaved] = useState(false);
  const sections = [
    "Account",
    "Playback",
    "Library",
    "Data",
    "Users",
    "Advanced",
  ];
  const field = (label: string, value?: string) => (
    <label>
      {label}
      <input
        type={label.toLowerCase().includes("password") ? "password" : "text"}
        defaultValue={value}
        autoComplete="off"
      />
    </label>
  );
  return (
    <div className="demo-route demo-settings-view">
      <h3>Settings</h3>
      <div className="demo-settings-layout">
        <nav aria-label="Settings sections">
          {sections.map((name) => (
            <button
              type="button"
              key={name}
              aria-current={section === name ? "page" : undefined}
              onClick={() => {
                setSection(name);
                setSaved(false);
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <form
          className="demo-settings-panel"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(true);
          }}
        >
          {section === "Account" && (
            <>
              <section>
                <h4>Username</h4>
                {field("Username", "listener")}
                {field("Current password")}
                <button type="submit">Save username</button>
              </section>
              <section>
                <h4>Change password</h4>
                {field("Current password")}
                {field("New password")}
                {field("Confirm new password")}
                <button type="submit">Change password</button>
              </section>
              <section>
                <button type="button" disabled>
                  Log out
                </button>
              </section>
            </>
          )}
          {section === "Playback" && (
            <>
              <label>
                Streaming quality
                <select defaultValue="Original">
                  {["Original", "High", "Medium", "Low"].map((quality) => (
                    <option key={quality}>{quality}</option>
                  ))}
                </select>
              </label>
              <button type="submit">Save</button>
            </>
          )}
          {section === "Library" && (
            <>
              <section>
                <h4>Music folders</h4>
                <div className="demo-settings-row">
                  <FolderOpen /> /music
                </div>
                <button type="button">Add folder</button>
              </section>
              <section>
                <h4>Library status</h4>
                <p>81 songs · 9 albums · 2 artists</p>
                <button type="button">Scan library</button>
              </section>
            </>
          )}
          {section === "Data" && (
            <>
              <section>
                <h4>Backups</h4>
                <div className="demo-settings-row">
                  <span>Daily backup</span>
                  <span>7.2 MB · Today, 20:16</span>
                </div>
                <button type="button">Create backup</button>{" "}
                <button type="button">Restore from backup</button>
              </section>
              <section>
                <h4>Your data</h4>
                <button type="button">Export your data</button>
              </section>
              <section>
                <h4>Cache</h4>
                <button type="button">Clear cache</button>
              </section>
            </>
          )}
          {section === "Users" && (
            <section>
              <h4>Users</h4>
              <div className="demo-settings-row">
                <span>listener</span>
                <span>Administrator</span>
              </div>
              <button type="button">Create user</button>
            </section>
          )}
          {section === "Advanced" && (
            <section>
              <h4>Hosting details</h4>
              <div className="demo-settings-row">
                <span>Version</span>
                <span>{sitePackage.version}</span>
              </div>
              <div className="demo-settings-row">
                <span>Address</span>
                <span>localhost:1993</span>
              </div>
            </section>
          )}
          {saved && <p role="status">Saved in this demo</p>}
        </form>
      </div>
    </div>
  );
}

function SearchView({
  query,
  onAlbum,
  onArtist,
  onPlay,
  onTrack,
}: DemoActions & {
  query: string;
  onTrack: (album: Album, index: number) => void;
}) {
  type Result = {
    kind: "Artist" | "Album" | "Song";
    name: string;
    album: Album;
    track?: number;
  };
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const term = normalize(query);
  const shorthand = (value: string) =>
    normalize(value)
      .split(" ")
      .map(
        (word) =>
          ({ to: "2", too: "2", for: "4", you: "u", and: "n" })[word] ??
          word[0],
      )
      .join("");
  const candidates: Result[] = [
    ...Array.from(new Set(albums.map((album) => album.artist))).map(
      (artist) => ({
        kind: "Artist" as const,
        name: artist,
        album: albums.find((album) => album.artist === artist)!,
      }),
    ),
    ...albums.map((album) => ({
      kind: "Album" as const,
      name: album.title,
      album,
    })),
    ...tracks.map((track, index) => ({
      kind: "Song" as const,
      name: track[0],
      album: demoSongAlbums[index],
      track: index,
    })),
  ];
  const results = candidates
    .map((item) => {
      const name = normalize(item.name);
      const compact = term.replace(/ /g, "");
      const initials = name
        .split(" ")
        .map((word) => word[0])
        .join("");
      let score = 0;
      if (name === term) {
        score = 100;
      } else if (name.startsWith(term)) {
        score = 80;
      } else if (name.includes(term)) {
        score = 60;
      } else if (compact === initials || compact === shorthand(item.name)) {
        score = 50;
      } else if (normalize(item.album.artist).includes(term)) {
        score = item.kind === "Album" ? 30 : 10;
      }
      return { ...item, score: term ? score : 0 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const activate = (item: Result) => {
    switch (item.kind) {
      case "Artist":
        onArtist(item.name);
        break;
      case "Album":
        onAlbum(item.album);
        break;
      case "Song":
        onTrack(item.album, item.track!);
        break;
    }
  };

  return (
    <div className="demo-route demo-search-view">
      <h3>Results for &quot;{query}&quot;</h3>
      <div className="demo-search-results">
        {results.map((item) => (
          <article key={item.kind + item.album.id + item.name}>
            {item.kind !== "Artist" && (
              <button
                className="demo-result-row"
                type="button"
                aria-label={
                  (item.kind === "Song" ? "Play " : "View ") + item.name
                }
                onClick={() => activate(item)}
              />
            )}
            <div
              className={
                "demo-result-cover" +
                (item.kind === "Artist" ? " demo-result-artist" : "")
              }
            >
              {item.kind === "Artist" ? (
                <UserRound />
              ) : (
                <img src={item.album.artwork} alt={item.name} />
              )}
            </div>
            <div className="demo-result-info">
              {item.kind === "Artist" ? (
                <button
                  className="demo-result-title"
                  type="button"
                  onClick={() => activate(item)}
                >
                  {item.name}
                </button>
              ) : (
                <span className="demo-result-title">{item.name}</span>
              )}
              <p>
                {item.kind}
                {item.kind !== "Artist" && " · " + item.album.artist}
              </p>
            </div>
            {item.kind !== "Artist" && (
              <button
                className="demo-result-play"
                type="button"
                aria-label={"Play " + item.name}
                onClick={() =>
                  item.kind === "Song"
                    ? onTrack(item.album, item.track!)
                    : onPlay(item.album)
                }
              >
                <Play />
              </button>
            )}
          </article>
        ))}
        {!results.length && (
          <p className="demo-search-empty">No matches for “{query}”</p>
        )}
      </div>
    </div>
  );
}

function ArtistView({
  artist,
  onAlbum,
  onPlay,
}: Pick<DemoActions, "onAlbum" | "onPlay"> & {
  artist: string;
}) {
  const artistAlbums = albums.filter((album) => album.artist === artist);
  const groups = [
    ["Albums", artistAlbums.filter((album) => album.type === "Album")],
    ["Editions", artistAlbums.filter((album) => album.type === "Edition")],
    [
      "Singles and remixes",
      artistAlbums.filter((album) => ["Single", "Remix"].includes(album.type)),
    ],
    [
      "Live recordings and bootlegs",
      artistAlbums.filter((album) => ["Live", "Bootleg"].includes(album.type)),
    ],
  ] as const;

  return (
    <div className="demo-route demo-artist-view">
      <h3>{artist}</h3>
      <div className="demo-discography">
        {groups.map(
          ([title, items]) =>
            items.length > 0 && (
              <section key={title}>
                <h4>{title}</h4>
                <div className="demo-artist-grid">
                  {items.map((album) => (
                    <MediaCard
                      key={album.id}
                      album={album}
                      onAlbum={onAlbum}
                      onArtist={() => {}}
                      onPlay={onPlay}
                      hideArtist
                    />
                  ))}
                </div>
              </section>
            ),
        )}
      </div>
    </div>
  );
}

function AlbumView({
  album,
  onArtist,
  onPlay,
  onTrack,
  activeTrack,
  playing,
}: Pick<DemoActions, "onArtist" | "onPlay"> & {
  album: Album;
  onTrack: (album: Album, index: number) => void;
  activeTrack?: number;
  playing: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="demo-route demo-album-view">
      <div className="demo-album-hero">
        <img src={album.artwork} alt="" />
        <div>
          <h3>{album.title}</h3>
          <button type="button" onClick={() => onArtist(album.artist)}>
            {album.artist}
          </button>
          <span>
            {" "}
            • {tracks.length} songs,{" "}
            {Math.round(tracks.reduce((sum, track) => sum + track[2], 0) / 60)}{" "}
            min
          </span>
        </div>
      </div>
      <div className="demo-album-actions">
        <button
          type="button"
          onClick={() => onPlay(album)}
          aria-label={`Play ${album.title}`}
        >
          <Play />
        </button>
        <div
          className="demo-more demo-album-more"
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            aria-label="Album actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Ellipsis />
          </button>
          {menuOpen && (
            <div className="demo-control-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => onPlay(album)}
              >
                <Play />
                Play
              </button>
              <button type="button" role="menuitem">
                <ListMusic />
                Add to queue
              </button>
              <hr />
              <button
                type="button"
                role="menuitem"
                onClick={() => onArtist(album.artist)}
              >
                <UserRound />
                View artist
              </button>
              <button type="button" role="menuitem">
                <Plus />
                Add to playlist
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="demo-track-header">
        <span>#</span>
        <span>Track</span>
        <Clock3 />
      </div>
      <ol className="demo-track-list">
        {tracks.map(([title, duration], index) => (
          <li
            key={title}
            className={activeTrack === index ? "active" : undefined}
          >
            <button
              className="demo-track-play"
              type="button"
              aria-label={`Play ${title}`}
              onClick={() => onTrack(album, index)}
            />
            <span>
              {activeTrack === index ? (
                playing ? (
                  <Pause />
                ) : (
                  <Play />
                )
              ) : (
                index + 1
              )}
            </span>
            <span>
              <b>{title}</b>
            </span>
            <time>{duration}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlaylistArtwork({
  compact = false,
  playlist,
}: {
  compact?: boolean;
  playlist: Playlist;
}) {
  if (playlist.liked) {
    return (
      <span
        className={`demo-playlist-artwork demo-liked-artwork${compact ? " compact" : ""}`}
        aria-hidden="true"
      >
        <Heart />
      </span>
    );
  }
  const covers = [
    playlist.album.artwork,
    albums[2].artwork,
    albums[4].artwork,
    albums[7].artwork,
  ];
  return (
    <span
      className={`demo-playlist-artwork${compact ? " compact" : ""}`}
      aria-hidden="true"
    >
      {covers.map((cover, index) => (
        <img src={cover} alt="" key={`${cover}-${index}`} />
      ))}
    </span>
  );
}

function PlaylistView({
  playlist,
  onArtist,
  onBack,
  onTrack,
}: Pick<DemoActions, "onArtist"> & {
  playlist: Playlist;
  onBack: () => void;
  onTrack: (album: Album, index: number) => void;
}) {
  const totalSeconds = playlist.trackIndexes.reduce(
    (sum, index) => sum + tracks[index][2],
    0,
  );
  const totalMinutes = Math.round(totalSeconds / 60);

  return (
    <div className="demo-route demo-playlist-view">
      <button className="demo-back" type="button" onClick={onBack}>
        <ArrowLeft /> Playlists
      </button>
      <div className="demo-playlist-hero">
        <PlaylistArtwork playlist={playlist} />
        <div>
          <h3>{playlist.name}</h3>
          {playlist.description && <p>{playlist.description}</p>}
          <span>
            {playlist.trackIndexes.length} songs · {totalMinutes} min
          </span>
        </div>
      </div>
      <div className="demo-album-actions demo-playlist-actions">
        <button
          type="button"
          className="demo-playlist-play"
          onClick={() =>
            onTrack(
              demoSongAlbums[playlist.trackIndexes[0]],
              playlist.trackIndexes[0],
            )
          }
          aria-label={`Play ${playlist.name}`}
        >
          <Play />
        </button>
        <button
          className="demo-shuffle"
          type="button"
          onClick={() =>
            onTrack(
              demoSongAlbums[
                playlist.trackIndexes[playlist.trackIndexes.length - 1]
              ],
              playlist.trackIndexes[playlist.trackIndexes.length - 1],
            )
          }
          aria-label={`Shuffle ${playlist.name}`}
        >
          <Shuffle />
        </button>
        <button
          className="demo-playlist-options"
          type="button"
          aria-label={`More options for ${playlist.name}`}
        >
          <Ellipsis />
        </button>
      </div>
      <div className="demo-track-header demo-playlist-track-header">
        <span>#</span>
        <span>Track</span>
        <span>Album</span>
        <Clock3 />
      </div>
      <ol className="demo-track-list demo-playlist-track-list">
        {playlist.trackIndexes.map((trackIndex, position) => {
          const [title, duration] = tracks[trackIndex];
          const album = demoSongAlbums[trackIndex];
          return (
            <li key={title} onDoubleClick={() => onTrack(album, trackIndex)}>
              <span>{position + 1}</span>
              <img src={album.artwork} alt="" />
              <span>
                <b>{title}</b>
                <button type="button" onClick={() => onArtist(album.artist)}>
                  {album.artist}
                </button>
              </span>
              <span>{album.title}</span>
              <time>{duration}</time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type DemoActions = {
  onAlbum: (album: Album) => void;
  onArtist: (artist: string) => void;
  onPlay: (album: Album) => void;
};

function MediaRow({
  title,
  songs = false,
  items,
  onAlbum,
  onArtist,
  onPlay,
}: DemoActions & { title: string; items: Album[]; songs?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (direction: number) =>
    ref.current?.scrollBy({ left: direction * 520, behavior: "smooth" });
  return (
    <section className="demo-media-row">
      <div className="demo-row-heading">
        <h4>{title}</h4>
        <div>
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label={`Scroll ${title} left`}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label={`Scroll ${title} right`}
          >
            <ChevronRight />
          </button>
        </div>
      </div>
      <div className="demo-row-scroll" ref={ref}>
        {items.map((album, index) => (
          <MediaCard
            key={`${title}-${album.id}`}
            album={album}
            onAlbum={onAlbum}
            onArtist={onArtist}
            onPlay={onPlay}
            trackTitle={songs ? tracks[index][0] : undefined}
            typeLabel={title === "Recently played" ? "Album" : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function MediaCard({
  album,
  onAlbum,
  onArtist,
  onPlay,
  hideArtist = false,
  trackTitle,
  typeLabel,
}: DemoActions & {
  album: Album;
  hideArtist?: boolean;
  trackTitle?: string;
  typeLabel?: string;
}) {
  return (
    <article
      className={`demo-media-card${trackTitle ? " demo-song-card" : ""}`}
    >
      <div className="demo-artwork">
        <button
          className="demo-cover-link"
          type="button"
          onClick={() => onAlbum(album)}
          aria-label={`Open ${album.title}`}
        >
          <img src={album.artwork} alt={`${album.title} cover`} />
        </button>
        <button
          className="demo-card-play"
          type="button"
          onClick={() => onPlay(album)}
          aria-label={`Play ${album.title}`}
        >
          <Play />
        </button>
      </div>
      <button
        className="demo-card-title"
        type="button"
        onClick={() => onAlbum(album)}
      >
        {trackTitle ?? album.title}
      </button>
      {!hideArtist && (
        <button
          className="demo-card-subtitle"
          type="button"
          onClick={() => onArtist(album.artist)}
        >
          {typeLabel && `${typeLabel} · `}
          {album.artist}
        </button>
      )}
    </article>
  );
}

const demoLyrics = [
  "Streetlights fade into the morning",
  "Windows glow and then they disappear",
  "Every mile is opening before us",
  "Nothing left to hold us here",
  "We can follow where the quiet goes",
  "Afterlight is all we need",
  "Leave the shadows at the doorway",
  "Let the open road begin",
  "Every color finds the horizon",
  "Every signal turns to gold",
  "Keep the moment moving forward",
  "There is more than we were told",
];

function DemoLyrics({
  album,
  activeLine,
  centerActiveLine,
  onClose,
  onLine,
}: {
  album: Album;
  activeLine: number;
  centerActiveLine?: boolean;
  onClose: () => void;
  onLine: (index: number) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const content = contentRef.current;
    const line = lineRefs.current[activeLine];
    if (!content || !line) {
      return;
    }
    content.scrollTo({
      top: line.offsetTop - content.clientHeight / 2 + line.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeLine]);

  return (
    <section
      className="demo-lyrics"
      aria-label="Lyrics view"
      onClick={(event) => {
        if (!(event.target as Element).closest(".demo-lyrics-content")) {
          onClose();
        }
      }}
    >
      <img
        className="demo-lyrics-backdrop"
        src={album.artwork}
        alt=""
        aria-hidden="true"
      />
      <div className="demo-lyrics-shade" />
      <div
        className={`demo-lyrics-content${centerActiveLine ? " capture-centered" : ""}`}
        ref={contentRef}
        style={
          centerActiveLine
            ? ({ "--active-line": activeLine } as CSSProperties)
            : undefined
        }
      >
        {demoLyrics.map((line, index) => (
          <button
            className={
              index === activeLine ? "active" : index < activeLine ? "past" : ""
            }
            key={line}
            ref={(node) => {
              lineRefs.current[index] = node;
            }}
            type="button"
            onClick={() => onLine(index)}
          >
            {line}
          </button>
        ))}
      </div>
    </section>
  );
}

function DemoQueue({
  album,
  activeTrack,
  onClose,
  onSelect,
}: {
  album: Album;
  activeTrack: number;
  onClose: () => void;
  onSelect: (index: number) => void;
}) {
  return (
    <section className="demo-queue" aria-label="Queue">
      <header>
        <div>
          <h4>Queue</h4>
        </div>
        <button type="button" onClick={onClose} aria-label="Close queue">
          <X />
        </button>
      </header>
      <ol>
        {tracks.map(([title], index) => {
          const rowAlbum =
            index === activeTrack ? album : demoSongAlbums[index];
          const isActive = index === activeTrack;
          return (
            <li className={isActive ? "active" : ""} key={title}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-label={`Play ${title}`}
              >
                <span className="demo-queue-cover">
                  <img src={rowAlbum.artwork} alt="" />
                  <span>
                    <Play />
                  </span>
                </span>
                <div>
                  <b>{title}</b>
                  <small>{rowAlbum.artist}</small>
                </div>
                {isActive && <span className="demo-queue-active-dot" />}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DemoPlayer({
  fullscreen,
  onFullscreen,
  volume,
  onVolume,
  onSeek,
  album,
  playing,
  lyricsOpen,
  queueOpen,
  liked,
  muted,
  soundEnabled,
  currentTime,
  trackDuration,
  trackTitle,
  onToggle,
  onPrevious,
  onNext,
  onToggleLike,
  onToggleLyrics,
  onToggleQueue,
  onToggleMute,
  onToggleSound,
  onArtist,
  onAlbum,
}: {
  fullscreen: boolean;
  onFullscreen: () => void;
  volume: number;
  onVolume: (value: number) => void;
  onSeek: (value: number) => void;
  album: Album;
  playing: boolean;
  lyricsOpen: boolean;
  queueOpen: boolean;
  liked: boolean;
  muted: boolean;
  soundEnabled: boolean;
  currentTime: number;
  trackDuration: number;
  trackTitle: string;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  onToggleLyrics: () => void;
  onToggleQueue: () => void;
  onToggleMute: () => void;
  onToggleSound: () => void;
  onArtist: (artist: string) => void;
  onAlbum: (album: Album) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPinned, setMenuPinned] = useState(false);
  const [preset, setPreset] = useState("Original");
  const [repeat, setRepeat] = useState(false);
  const volumeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = volumeRef.current;
    if (!element) {
      return;
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      onVolume(
        Math.min(
          100,
          Math.max(0, (muted ? 0 : volume) + (event.deltaY < 0 ? 5 : -5)),
        ),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [muted, volume, onVolume]);
  const progress = Math.min(100, (currentTime / trackDuration) * 100);
  return (
    <footer
      className={`demo-player${fullscreen ? " demo-player-fullscreen" : ""}`}
    >
      <div className="demo-player-track">
        <button
          className="demo-player-cover"
          type="button"
          onClick={() => onAlbum(album)}
          aria-label={`Open ${album.title}`}
        >
          <img src={album.artwork} alt="" />
        </button>
        <span>
          <button
            className="demo-player-title"
            type="button"
            onClick={() => onAlbum(album)}
          >
            {trackTitle}
          </button>
          <button type="button" onClick={() => onArtist(album.artist)}>
            {album.artist}
          </button>
        </span>
        <button
          className={`demo-like ${liked ? "active" : ""}`}
          type="button"
          onClick={onToggleLike}
          aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          aria-pressed={liked}
        >
          <Heart />
        </button>
      </div>
      <div className="demo-player-center">
        <div>
          <button type="button" onClick={onPrevious} aria-label="Previous">
            <SkipBack />
          </button>
          <button
            className="demo-main-play"
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button type="button" onClick={onNext} aria-label="Next">
            <SkipForward />
          </button>
        </div>
        <span>
          <small>{formatTime(currentTime)}</small>
          <i>
            <em style={{ width: `${progress}%` }} />
            <input
              type="range"
              aria-label="Playback position"
              min={0}
              max={trackDuration}
              step={0.01}
              value={currentTime}
              onChange={(event) => onSeek(Number(event.target.value))}
            />
          </i>
          <small>{formatTime(trackDuration)}</small>
        </span>
      </div>
      <div className="demo-player-actions">
        <button
          className={`demo-queue-button ${queueOpen ? "active" : ""}`}
          type="button"
          aria-label="Queue"
          aria-pressed={queueOpen}
          title="Queue"
          onClick={onToggleQueue}
        >
          <ListMusic />
        </button>
        <button
          className={`demo-lyrics-button ${lyricsOpen ? "active" : ""}`}
          type="button"
          aria-label="Lyrics"
          aria-pressed={lyricsOpen}
          title="Lyrics"
          onClick={onToggleLyrics}
        >
          <MicVocal />
          {fullscreen && <span>Lyrics</span>}
        </button>
        <button
          className={soundEnabled ? "active" : ""}
          type="button"
          aria-label="Sound"
          aria-pressed={soundEnabled}
          title="Sound"
          onClick={onToggleSound}
        >
          <AudioLines />
        </button>
        <div className="demo-volume" ref={volumeRef}>
          <input
            aria-label="Volume"
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(event) => onVolume(Number(event.target.value))}
          />
          <button
            className={muted ? "active" : ""}
            type="button"
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            title={muted ? "Unmute" : "Mute"}
            onClick={onToggleMute}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
        </div>
        <div
          className="demo-more"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setMenuOpen(false);
              setMenuPinned(false);
            }
          }}
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => {
            if (!menuPinned) {
              setMenuOpen(false);
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setMenuOpen(false);
              setMenuPinned(false);
            }
          }}
        >
          <button
            type="button"
            aria-label="More controls"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => {
              setMenuOpen(true);
              setMenuPinned(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setMenuOpen(false);
                setMenuPinned(false);
              }
            }}
          >
            <Ellipsis />
          </button>
          {menuOpen && (
            <div className="demo-control-menu" role="menu">
              {fullscreen && (
                <>
                  <button type="button" role="menuitem" onClick={onToggleQueue}>
                    <ListMusic />
                    {queueOpen ? "Now playing" : "Queue"}
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={repeat}
                    onClick={() => setRepeat((value) => !value)}
                  >
                    Repeat
                  </button>
                  <hr />
                </>
              )}
              <p>Sound</p>
              {["Original", "Slow", "Deep Slow", "Faster"].map((label) => (
                <button
                  key={label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={
                    soundEnabled ? preset === label : label === "Original"
                  }
                  onClick={() => {
                    setPreset(label);
                    if ((label !== "Original") !== soundEnabled) {
                      onToggleSound();
                    }
                  }}
                >
                  <span className="demo-radio">
                    {(soundEnabled ? preset === label : label === "Original")
                      ? "●"
                      : ""}
                  </span>
                  {label}
                </button>
              ))}
              {!fullscreen && (
                <>
                  <hr />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onFullscreen();
                    }}
                  >
                    <Maximize2 />
                    Fullscreen
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
