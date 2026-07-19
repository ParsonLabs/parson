"use client";

import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderOpen,
  Globe2,
  HardDrive,
  Heart,
  Home,
  Library,
  ListMusic,
  MicVocal,
  Minus,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  | { name: "album"; album: Album };

function BrandMark() {
  return (
    <span className="demo-brand-mark" aria-hidden="true">
      P
    </span>
  );
}

type InteractiveProductDemoProps = {
  initialAlbumId?: string;
  initialPanel?: "lyrics" | "queue";
  initialPlaying?: boolean;
  initialQuery?: string;
  initialTime?: number;
  initialTrackIndex?: number;
  initialView?: "album" | "artist" | "home" | "library" | "settings";
};

export default function InteractiveProductDemo({
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
  const initialViewState: View =
    initialView === "album"
      ? { name: "album", album: initialAlbum }
      : initialView === "artist"
        ? { name: "artist", artist: initialAlbum.artist }
        : { name: initialView };
  const [view, setView] = useState<View>(initialViewState);
  const [query, setQuery] = useState(initialQuery);
  const [playing, setPlaying] = useState(initialPlaying);
  const [currentAlbum, setCurrentAlbum] = useState(initialAlbum);
  const [lyricsOpen, setLyricsOpen] = useState(initialPanel === "lyrics");
  const [queueOpen, setQueueOpen] = useState(initialPanel === "queue");
  const [currentTrackIndex, setCurrentTrackIndex] = useState(
    safeInitialTrackIndex,
  );
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [liked, setLiked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showMacWindowControls, setShowMacWindowControls] = useState(false);
  const trackDuration = tracks[currentTrackIndex][2];

  useEffect(() => {
    const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
    setShowMacWindowControls(/macintosh|mac os|macintel/.test(source));
  }, []);

  const closePanels = () => {
    setLyricsOpen(false);
    setQueueOpen(false);
  };
  const goHome = () => {
    closePanels();
    setQuery("");
    setView({ name: "home" });
  };
  const openLibrary = () => {
    closePanels();
    setQuery("");
    setView({ name: "library" });
  };
  const openSettings = () => {
    closePanels();
    setQuery("");
    setView({ name: "settings" });
  };
  const openArtist = (artist = "Mira Sol") => {
    closePanels();
    setQuery("");
    setView({ name: "artist", artist });
  };
  const openAlbum = (album: Album) => {
    closePanels();
    setQuery("");
    setView({ name: "album", album });
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
  const selectQueueTrack = (index: number) => {
    setCurrentTrackIndex(index);
    setCurrentTime(0);
    setPlaying(true);
  };

  const activeLyric = useMemo(() => {
    let active = 0;
    lyricTimes.forEach((time, index) => {
      if (time <= currentTime) active = index;
    });
    return active;
  }, [currentTime]);

  const visibleAlbums = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return albums;
    return albums.filter((album) =>
      `${album.title} ${album.artist}`.toLowerCase().includes(value),
    );
  }, [query]);

  useEffect(() => {
    const closeLyrics = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanels();
    };
    window.addEventListener("keydown", closeLyrics);
    return () => window.removeEventListener("keydown", closeLyrics);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCurrentTime((value) => (value >= trackDuration ? 0 : value + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing, currentTrackIndex, currentAlbum.id]);

  useEffect(() => {
    if (!lyricsOpen && !queueOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (
        lyricsOpen &&
        !target.closest(".demo-lyrics") &&
        !target.closest(".demo-lyrics-button")
      )
        setLyricsOpen(false);
      if (
        queueOpen &&
        !target.closest(".demo-queue") &&
        !target.closest('[aria-label="Queue"]')
      )
        setQueueOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [lyricsOpen, queueOpen]);

  return (
    <div
      className="demo-app"
      role="region"
      aria-label="Interactive Parson product demo"
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
            className={view.name === "home" ? "active" : ""}
            type="button"
            onClick={goHome}
            title="Home"
            aria-label="Home"
            aria-current={view.name === "home" ? "page" : undefined}
          >
            <Home />
          </button>
          <button
            className={view.name === "library" ? "active" : ""}
            type="button"
            onClick={openLibrary}
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
        <form onSubmit={(event) => event.preventDefault()}>
          <Search />
          <input
            aria-label="Search demo library"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What do you want to play?"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              ×
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
        {query.trim() ? (
          <SearchView
            albums={visibleAlbums}
            onAlbum={openAlbum}
            onArtist={openArtist}
            onPlay={playAlbum}
          />
        ) : view.name === "home" ? (
          <HomeView
            onAlbum={openAlbum}
            onArtist={openArtist}
            onPlay={playAlbum}
          />
        ) : view.name === "library" ? (
          <LibraryView
            onAlbum={openAlbum}
            onArtist={openArtist}
            onPlay={playAlbum}
          />
        ) : view.name === "settings" ? (
          <SettingsView />
        ) : view.name === "artist" ? (
          <ArtistView
            artist={view.artist}
            onAlbum={openAlbum}
            onBack={goHome}
            onPlay={playAlbum}
          />
        ) : (
          <AlbumView
            album={view.album}
            onArtist={openArtist}
            onBack={() => openArtist(view.album.artist)}
            onPlay={playAlbum}
          />
        )}
      </div>

      {lyricsOpen && (
        <DemoLyrics
          album={currentAlbum}
          activeLine={activeLyric}
          centerActiveLine={initialPanel === "lyrics"}
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
          onSelect={selectQueueTrack}
        />
      )}

      <DemoPlayer
        album={currentAlbum}
        playing={playing}
        lyricsOpen={lyricsOpen}
        queueOpen={queueOpen}
        liked={liked}
        muted={muted}
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

function LibraryView({ onAlbum, onArtist, onPlay }: DemoActions) {
  const artists = [
    { name: "Mira Sol", detail: "7 releases", artwork: albums[0].artwork },
    { name: "North Arcade", detail: "2 albums", artwork: albums[2].artwork },
  ];

  return (
    <div className="demo-route demo-library-view">
      <h3>Library</h3>
      <section className="demo-library-artists">
        <h4>Artists</h4>
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
      <section className="demo-library-albums">
        <h4>Albums</h4>
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
    </div>
  );
}

function SettingsView() {
  const settings = [
    {
      title: "Music folders",
      detail: "2 folders - available",
      Icon: FolderOpen,
    },
    {
      title: "Storage",
      detail: "Local library and artwork cache",
      Icon: HardDrive,
    },
    {
      title: "Remote access",
      detail: "Ready when this host is running",
      Icon: Globe2,
    },
  ];

  return (
    <div className="demo-route demo-settings-view">
      <h3>Settings</h3>
      <p>Everything needed to run your library, in one place.</p>
      <div className="demo-settings-list">
        {settings.map(({ title, detail, Icon }) => (
          <div key={title}>
            <Icon />
            <span>
              <b>{title}</b>
              <small>{detail}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchView({
  albums: results,
  onAlbum,
  onArtist,
  onPlay,
}: DemoActions & { albums: Album[] }) {
  return (
    <div className="demo-route demo-search-view">
      <p className="demo-eyebrow">Search results</p>
      <h3>{results.length ? `${results.length} matches` : "Nothing found"}</h3>
      <div className="demo-search-grid">
        {results.map((album) => (
          <MediaCard
            key={album.id}
            album={album}
            onAlbum={onAlbum}
            onArtist={onArtist}
            onPlay={onPlay}
          />
        ))}
      </div>
    </div>
  );
}

function ArtistView({
  artist,
  onAlbum,
  onBack,
  onPlay,
}: Pick<DemoActions, "onAlbum" | "onPlay"> & {
  artist: string;
  onBack: () => void;
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
      <button className="demo-back" type="button" onClick={onBack}>
        <ArrowLeft /> Home
      </button>
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
  onBack,
  onPlay,
}: Pick<DemoActions, "onArtist" | "onPlay"> & {
  album: Album;
  onBack: () => void;
}) {
  return (
    <div className="demo-route demo-album-view">
      <button className="demo-back" type="button" onClick={onBack}>
        <ArrowLeft /> Artist
      </button>
      <div className="demo-album-hero">
        <img src={album.artwork} alt="" />
        <div>
          <p>{album.type}</p>
          <h3>{album.title}</h3>
          <button type="button" onClick={() => onArtist(album.artist)}>
            {album.artist}
          </button>
          <span> - {tracks.length} songs, 19 min</span>
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
      </div>
      <div className="demo-track-header">
        <span>#</span>
        <span>Title</span>
        <Clock3 />
      </div>
      <ol className="demo-track-list">
        {tracks.map(([title, duration], index) => (
          <li key={title} onDoubleClick={() => onPlay(album)}>
            <span>{index + 1}</span>
            <span>
              <b>{title}</b>
              <button type="button" onClick={() => onArtist(album.artist)}>
                {album.artist}
              </button>
            </span>
            <time>{duration}</time>
          </li>
        ))}
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
  items,
  onAlbum,
  onArtist,
  onPlay,
}: DemoActions & { title: string; items: Album[] }) {
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
        {items.map((album) => (
          <MediaCard
            key={`${title}-${album.id}`}
            album={album}
            onAlbum={onAlbum}
            onArtist={onArtist}
            onPlay={onPlay}
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
}: DemoActions & { album: Album; hideArtist?: boolean }) {
  return (
    <article className="demo-media-card">
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
        {album.title}
      </button>
      {hideArtist ? (
        <span className="demo-card-subtitle">{album.type}</span>
      ) : (
        <button
          className="demo-card-subtitle"
          type="button"
          onClick={() => onArtist(album.artist)}
        >
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
    if (!content || !line) return;
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
        if (!(event.target as Element).closest(".demo-lyrics-content"))
          onClose();
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
          <p>Queue</p>
          <h4>{album.title}</h4>
        </div>
        <button type="button" onClick={onClose} aria-label="Close queue">
          <X />
        </button>
      </header>
      <ol>
        {tracks.slice(activeTrack).map(([title, duration], offset) => {
          const index = activeTrack + offset;
          const isActive = index === activeTrack;
          return (
            <li className={isActive ? "active" : ""} key={title}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-label={`Play ${title}`}
              >
                <span className="demo-queue-position">
                  {isActive ? <Volume2 aria-hidden="true" /> : offset}
                </span>
                <div>
                  <b>{title}</b>
                  <small>
                    {isActive ? "Now playing · " : ""}
                    {album.artist}
                  </small>
                </div>
                <time>{duration}</time>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DemoPlayer({
  album,
  playing,
  lyricsOpen,
  queueOpen,
  liked,
  muted,
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
  onArtist,
  onAlbum,
}: {
  album: Album;
  playing: boolean;
  lyricsOpen: boolean;
  queueOpen: boolean;
  liked: boolean;
  muted: boolean;
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
  onArtist: (artist: string) => void;
  onAlbum: (album: Album) => void;
}) {
  const progress = Math.min(100, (currentTime / trackDuration) * 100);
  return (
    <footer className="demo-player">
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
          </i>
          <small>{formatTime(trackDuration)}</small>
        </span>
      </div>
      <div className="demo-player-actions">
        <button
          className={queueOpen ? "active" : ""}
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
        </button>
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
    </footer>
  );
}
