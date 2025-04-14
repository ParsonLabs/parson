"use client";

import getBaseURL from "@/lib/Server/getBaseURL";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import getSession from "@/lib/Authentication/JWT/getSession";
import {
  addSongToListenHistory,
  getRandomSong,
  getSongInfo,
  getSongsByGenres,
  setNowPlaying,
} from "@music/sdk";
import { Album, Artist, Genre, LibrarySong, Song } from "@music/sdk/types";
import { useSession } from "@/components/Providers/AuthProvider";
import YouTubePlayer from "./YouTubePlayer";
import ReactPlayer from "react-player";

const isBrowser = typeof window !== "undefined";
const audioElement = isBrowser ? new Audio() : null;

type PlayerContextType = {
  playAudioSource: Function;
  isPlaying: boolean;
  onLoop: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  playedFromAlbum: boolean;
  setPlayedFromAlbum: Function;
  togglePlayPause: Function;
  toggleLoopSong: Function;
  playNextSong: Function;
  playPreviousSong: Function;
  setAudioVolume: Function;
  handleTimeChange: Function;
  handleTimeUpdate: Function;
  toggleMute: Function;
  setAudioSource: Function;
  isDraggingSeekBar: boolean;
  setIsDraggingSeekBar: Function;
  setSong: Function;
  setArtist: Function;
  setAlbum: Function;
  setSongCallback: Function;
  setImageSrc: Function;
  setQueue: Function;
  addToQueue: Function;
  setBufferedTime: Function;
  bufferedTime: number;
  imageSrc: string;
  song: LibrarySong;
  artist: Artist;
  album: Album;
  queue: Queue[];
};

type Queue = {
  song: LibrarySong;
  album: Album;
  artist: Artist;
};

const PlayerContext = createContext<PlayerContextType | null>(null);

interface PlayerProviderProps {
  children: React.ReactNode;
}

export function PlayerProvider({ children }: PlayerProviderProps) {
  const audioRef = useRef<HTMLAudioElement>(audioElement);
  const audio = audioRef.current as HTMLAudioElement;

  const [imageSrc, setImageSrc] = useState("");
  const [audioSource, setAudioSourceState] = useState("");
  const [song, setSong] = useState<LibrarySong>({
    artist: "",
    contributing_artists: [],
    name: "",
    path: "",
    track_number: 0,
    id: "",
    contributing_artist_ids: [],
    music_video: undefined,
    duration: 0,
    artist_object: {
      albums: [],
      description: "",
      followers: 0,
      icon_url: "",
      id: "",
      name: "",
      featured_on_album_ids: [],
    },
    album_object: {
      cover_url: "",
      description: "",
      first_release_date: "",
      id: "",
      musicbrainz_id: "",
      name: "",
      primary_type: "",
      songs: [],
      wikidata_id: "",
      contributing_artists: [],
      contributing_artists_ids: [],
      release_album: undefined,
      release_group_album: undefined,
    },
  });
  const [artist, setArtist] = useState<Artist>({
    albums: [],
    id: "",
    name: "",
    followers: 0,
    icon_url: "",
    description: "",
    featured_on_album_ids: [],
    tadb_music_videos: undefined,
  });
  const [album, setAlbum] = useState<Album>({
    cover_url: "",
    id: "",
    name: "",
    description: "",
    first_release_date: "",
    musicbrainz_id: "",
    primary_type: "",
    wikidata_id: "",
    songs: [],
    contributing_artists: [],
    contributing_artists_ids: [],
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueueState] = useState<Queue[]>([]);
  const [playedFromAlbum, setPlayedFromAlbum] = useState(false);

  const queueRef = useRef<Queue[]>([]);

  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [onLoop, setOnLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [base64Image, setBase64Image] = useState("");
  const [bufferedTime, setBufferedTime] = useState(0);

  const [isDraggingSeekBar, setIsDraggingSeekBar] = useState(false);

  const lastAddedSongIdRef = useRef<string | null>(null);

  let bitrate = 0;

  const { session } = useSession();

  const [isYouTubeUrl, setIsYouTubeUrl] = useState(false);
  const youTubePlayerRef = useRef<HTMLDivElement>(null);

  const isUserSeeking = useRef(false);
  const lastReportedTime = useRef(0);

  useEffect(() => {
    return () => {
      if (isYouTubeUrl) {
        setIsYouTubeUrl(false);
      }
    };
  }, [song?.id, isYouTubeUrl]);

  const handleDirectSeek = useCallback(
    (seconds: number) => {
      if (isYouTubeUrl) {
        setCurrentTime(seconds);
      } else {
        if (audioRef.current) {
          audioRef.current.currentTime = seconds;
          setCurrentTime(seconds);
        }
      }
    },
    [isYouTubeUrl]
  );

  useEffect(() => {
    if (song.id && lastAddedSongIdRef.current != String(song.id)) {
      if (session) {
        setNowPlaying(Number(session.sub), String(song.id));
        addSongToListenHistory(Number(session.sub), String(song.id));

        lastAddedSongIdRef.current = String(song.id);
      }
    }
  }, [song.id, session]);

  const playAudioSource = useCallback(() => {
    audio.currentTime = 0;
    if (isYouTubeUrl) {
      setIsPlaying(true);
      return;
    }

    if (!audio) {
      console.error("Audio element is not available");
      return;
    }

    const cleanupEvents = () => {
      audio.oncanplaythrough = null;
      audio.onloadeddata = null;
      audio.onloadedmetadata = null;
      audio.onprogress = null;
      audio.onerror = null;
      audio.onloadstart = null;
    };

    cleanupEvents();

    audio.pause();
    audio.currentTime = 0;

    if (!audioSource) {
      console.error("No audio source provided");
      return;
    }

    // const sourceUrl = audioSource.startsWith("http")
    //   ? audioSource
    //   : `${getBaseURL()}/api/stream/${encodeURIComponent(
    //       audioSource
    //     )}?bitrate=${session?.bitrate || 0}`;

    const sourceUrl = audioSource;

    const loadStartTime = Date.now();
    let playbackAttempted = false;

    audio.src = sourceUrl;
    audio.load();

    const attemptPlay = () => {
      if (playbackAttempted) return;
      playbackAttempted = true;

      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          cleanupEvents();
        })
        .catch((err) => {
          console.error("Play attempt failed:", err.name || err);
          playbackAttempted = false;

          setTimeout(() => {
            audio
              .play()
              .then(() => {
                setIsPlaying(true);
                cleanupEvents();
              })
              .catch((finalErr) => {
                console.error(
                  "Final play attempt failed:",
                  finalErr.name || finalErr
                );

                if (session?.bitrate && session.bitrate > 0) {
                  const lowerBitrate = Math.floor(session.bitrate * 0.75);
                  // const fallbackUrl = audioSource.startsWith("http")
                  //   ? audioSource
                  //   : `${getBaseURL()}/api/stream/${encodeURIComponent(
                  //       audioSource
                  //     )}?bitrate=${lowerBitrate}`;


                  const fallbackUrl = audioSource;

                  audio.src = fallbackUrl;
                  audio.load();

                  const fallbackPlayHandler = () => {
                    audio
                      .play()
                      .then(() => {
                        setIsPlaying(true);
                        audio.removeEventListener(
                          "loadeddata",
                          fallbackPlayHandler
                        );
                      })
                      .catch(() => {
                        audio.removeEventListener(
                          "loadeddata",
                          fallbackPlayHandler
                        );
                      });
                  };

                  audio.addEventListener("loadeddata", fallbackPlayHandler);
                }
              });
          }, 800);
        });
    };


    audio.onloadeddata = () => {
      if (!playbackAttempted && audio.readyState >= 2) {
        attemptPlay();
      }
    };

    audio.oncanplaythrough = () => {
      attemptPlay();
    };

    audio.onloadedmetadata = () => {
      if (!playbackAttempted && audio.readyState >= 3) {
        attemptPlay();
      }
    };

    const timeoutId = setTimeout(() => {
      if (!playbackAttempted) {
        attemptPlay();
      }
    }, 2500);

    audio.onerror = (e) => {
      clearTimeout(timeoutId);
      cleanupEvents();

      const errorInfo = {
        code: audio.error?.code,
        message: audio.error?.message,
      };
      console.error("Audio loading error:", errorInfo);

      if (session?.bitrate && session.bitrate > 0) {
        const lowerBitrate = Math.floor(session.bitrate * 0.75);
        // const fallbackUrl = audioSource.startsWith("http")
        //   ? audioSource
        //   : `${getBaseURL()}/api/stream/${encodeURIComponent(
        //       audioSource
        //     )}?bitrate=${lowerBitrate}`;
        const fallbackUrl = audioSource;

        audio.src = fallbackUrl;
        audio.load();

        audio.onloadeddata = attemptPlay;
      }
    };

    return () => {
      clearTimeout(timeoutId);
      cleanupEvents();
    };
  }, [audioSource, audio, isYouTubeUrl, session?.bitrate]);

  const setQueue = useCallback((newQueue: Queue[]) => {
    queueRef.current = newQueue;
    setQueueState(newQueue);
  }, []);

  const setAudioSource = useCallback(
    (source: string) => {
      const isYT =
        source.includes("youtube.com") || source.includes("youtu.be");

      if (isYT !== isYouTubeUrl) {
        if (audioRef.current) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
      }

      setIsYouTubeUrl(isYT);

      // if (!isYT) {
      //   source = `${getBaseURL()}/api/stream/${encodeURIComponent(
      //     source
      //   )}?bitrate=${session?.bitrate || 0}`;
      // }

      setAudioSourceState(source);
    },
    [isYouTubeUrl, session?.bitrate]
  );
  useEffect(() => {
    if (!audioSource) return;

    const isYT =
      audioSource.includes("youtube.com") || audioSource.includes("youtu.be");
    setIsYouTubeUrl(isYT);

    if (isYT) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
    } else {
      // const formattedSource = audioSource.startsWith("http")
      //   ? audioSource
      //   : `${getBaseURL()}/api/stream/${encodeURIComponent(
      //       audioSource
      //     )}?bitrate=${bitrate}`;

        const formattedSource = audioSource

      if (audioRef.current && audioRef.current.src !== formattedSource) {
        const wasPlaying = !audioRef.current.paused;

        audioRef.current.src = formattedSource;
        audioRef.current.load();

        audioRef.current.oncanplaythrough = null;

        if (wasPlaying) {
          audioRef.current.oncanplaythrough = function oncePlayable() {
            audioRef.current!.oncanplaythrough = null;

            audioRef.current!
              .play()
              .then(() => {
                console.log("Audio resumed after source change");
              })
              .catch((err) => {
                console.error("Failed to resume after source change:", err);
                setIsPlaying(false);
              });
          };
        }
      }
    }
  }, [audioSource, bitrate]);

  const setSongCallback = useCallback(
    async (song: LibrarySong, artist: Artist, album: Album) => {
      const wasPlaying = isPlaying;

      setSong(song);
      setArtist(artist);
      setAlbum(album);

      if (album.cover_url.length === 0) {
        setBase64Image("/snf.png");
        setImageSrc("/snf.png");
      } else {
        setImageSrc(
          `${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}`
        );
      }

      const isYouTubeUrl =
        song.path.includes("youtube.com") || song.path.includes("youtu.be");

      if (isYouTubeUrl) {
        setAudioSource(song.path);

        if (wasPlaying) {
          if (audioRef.current) {
            audioRef.current.pause();
          }

          setIsPlaying(false);

          setTimeout(() => {
            setIsPlaying(true);
          }, 300);
        }
      } else {
        setAudioSource(
          `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${
            bitrate
          }`
        );
      }

      const index = queueRef.current.findIndex((q) => q.song.id === song.id);
      if (index !== -1) {
        setCurrentSongIndex(index);
      }
    },
    [bitrate, isPlaying, setAudioSource]
  );
  const playNextSong = useCallback(async () => {
    if (playedFromAlbum && album) {
      let nextSongIndex =
        album.songs.findIndex((albumSong) => String(albumSong.id) === String(song.id)) + 1;

      if (nextSongIndex >= album.songs.length) {
        nextSongIndex = 0;
      }

      const nextSong = album.songs[nextSongIndex];
      if (nextSong) {
        setSongCallback(nextSong, artist, album);
        playAudioSource();
        return;
      }
    }

    let nextSongIndex = currentSongIndex + 1;
    if (nextSongIndex >= queueRef.current.length) {
      nextSongIndex = 0;
    }
    setCurrentSongIndex(nextSongIndex);
    const next = queueRef.current[nextSongIndex];

    if (next) {
      const { song: nextSong, artist: nextArtist, album: nextAlbum } = next;

      if (nextSong) {
        setSongCallback(nextSong, nextArtist, nextAlbum);
        playAudioSource();
      }
    } else {
      let songGenres: Genre[] = [];
      if (song.album_object?.release_album?.genres) {
        songGenres = song.album_object.release_album.genres;
      } else if (song.album_object?.release_group_album?.genres) {
        songGenres = song.album_object.release_group_album.genres;
      }

      let recommendedSong = null;
      for (let i = 0; i < songGenres.length; i++) {
        const genre = songGenres[i];
        if (genre?.name) {
          const recommendedSongs = await getSongsByGenres([genre.name]);
          const shuffledRecommendedSongs = [...recommendedSongs];

          for (let i = shuffledRecommendedSongs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [
              shuffledRecommendedSongs[i] as any,
              shuffledRecommendedSongs[j] as any,
            ] = [shuffledRecommendedSongs[j], shuffledRecommendedSongs[i]];
          }

          for (let shuffledSong of shuffledRecommendedSongs) {
            if (shuffledSong.name !== song.name) {
              recommendedSong = (await getSongInfo(shuffledSong.id)) as LibrarySong;
              break;
            }
          }

          if (recommendedSong) break;
        }
      }

      if (recommendedSong) {
        const {
          artist_object: recommendedArtist,
          album_object: recommendedAlbum,
        } = recommendedSong;
        setSongCallback(recommendedSong, recommendedArtist, recommendedAlbum);
        playAudioSource();
      } else {
        const randomSongs = await getRandomSong(1);
        if (randomSongs.length > 0) {
          const randomSong = randomSongs[0];
          if (randomSong) {
            setSongCallback(
              randomSong,
              randomSong.artist_object,
              randomSong.album_object
            );
            playAudioSource();
          }
        }
      }
    }
  }, [
    currentSongIndex,
    setSongCallback,
    playAudioSource,
    song,
    album,
    artist,
    playedFromAlbum,
  ]);

  const playPreviousSong = useCallback(() => {
    let previousSongIndex = currentSongIndex - 1;
    if (previousSongIndex < 0) {
      previousSongIndex = queueRef.current.length - 1;
    }
    setCurrentSongIndex(previousSongIndex);
    const previous = queueRef.current[previousSongIndex];
    if (previous) {
      const previousSong = previous.song;
      const previousArtist = previous.artist;
      const previousAlbum = previous.album;

      if (previousSong) {
        setSongCallback(previousSong, previousArtist, previousAlbum);
        playAudioSource();
      }
    }
  }, [currentSongIndex, setSongCallback, playAudioSource]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.src = audioSource;
    }

    if (audio) {
      audio.addEventListener("ended", playNextSong);

      return () => {
        audio.removeEventListener("ended", playNextSong);
      };
    }
  }, [audioSource, playNextSong, audio]);

  const removeFromQueue = useCallback((index: number) => {
    const newQueue = [...queueRef.current];
    newQueue.splice(index, 1);
    queueRef.current = newQueue;
    setQueueState(newQueue);
  }, []);

  const addToQueue = useCallback(
    (song: LibrarySong, album: Album, artist: Artist) => {
      const newQueue = [...queueRef.current, { song, album, artist }];
      queueRef.current = newQueue;
      setQueueState(newQueue);
    },
    []
  );

  const toggleMute = useCallback(() => {
    const audio = audioRef.current || new Audio();
    audio.muted = !muted;
    setMuted(!muted);
  }, [muted]);

    const togglePlayPause = useCallback(() => {
      if (audio.paused) {
        audio.play()
        setIsPlaying(true)
      } else {

        audio.pause()
        setIsPlaying(false)
      }
  }, [audio]);

  useEffect(() => {
    if (audio && "mediaSession" in navigator) {
      let normalisedAlbumPath = album.cover_url.startsWith("\\\\?\\")
        ? album.cover_url.substring(4)
        : album.cover_url;
      let albumPath = `${getBaseURL()}/image/${encodeURIComponent(
        normalisedAlbumPath
      )}?raw=true`;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name,
        artist: song.artist,
        album: album.name,
        artwork: [{ src: albumPath, type: "image/jpeg" }],
      });
      navigator.mediaSession.setActionHandler("play", () => togglePlayPause());
      navigator.mediaSession.setActionHandler("pause", () => togglePlayPause());
      navigator.mediaSession.setActionHandler("previoustrack", playPreviousSong);
      navigator.mediaSession.setActionHandler("nexttrack", playNextSong);
    }
  }, [
    song.name,
    song.artist,
    album.name,
    album.cover_url,
    playNextSong,
    playPreviousSong,
    togglePlayPause,
    audio
  ]);

  const toggleLoopSong = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.loop = !onLoop;
      setOnLoop(!onLoop);
    }
  }, [onLoop]);

  const setAudioVolume = useCallback((value: string) => {
    let volume = parseFloat(value) / 100;
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      setVolume(volume);
    }
  }, []);

  const handleTimeChange = useCallback(
    (value: string) => {
      const newTime = parseFloat(value);

      isUserSeeking.current = true;

      if (isYouTubeUrl) {
        setCurrentTime(newTime);

        if (playerRef.current?.seekTo) {
          playerRef.current.seekTo(newTime, "seconds");
        }
      } else {
        if (audioRef.current) {
          audioRef.current.currentTime = newTime;
        }
        setCurrentTime(newTime);
      }

      setTimeout(() => {
        isUserSeeking.current = false;
      }, 250);
    },
    [isYouTubeUrl]
  );

  const playerRef = useRef<ReactPlayer>(null);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration);
      const buffer = audio.buffered;
      if (buffer && buffer.length > 0) {
        setBufferedTime(buffer.end(buffer.length - 1));
      }
    }
  }, []);

  const handleTimeUpdateThrottled = useCallback(() => {
    setTimeout(() => {
      handleTimeUpdate();
    }, 1000);
  }, [handleTimeUpdate]);

  useEffect(() => {
    function stepForward() {
      setTimeout(() => {
        audio.currentTime += 1;
      }, 200);
    }
    function stepBack() {
      setTimeout(() => {
        audio.currentTime -= 1;
      }, 200);
    }

    if (audio) {
      audio.addEventListener("timeupdate", handleTimeUpdate);

      const handleKeyPress = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (target.tagName.toLowerCase() === "input") {
          return;
        }
        switch (event.key.toLocaleLowerCase()) {
          case " ":
            togglePlayPause();
            break;
          case "m":
            toggleMute();
            break;
          case "l":
            toggleLoopSong();
            break;
        }
      };

      const handleKeyUp = (event: KeyboardEvent) => {
        if ((event.target as HTMLElement).tagName.toLowerCase() === "input") {
          return;
        }
        switch (event.key.toLowerCase()) {
          case "arrowleft":
            stepBack();
            break;
          case "arrowright":
            stepForward();
            break;
        }
      };

      document.addEventListener("keydown", handleKeyPress);
      document.addEventListener("keyup", handleKeyUp);

      return () => {
        audio.removeEventListener("timeupdate", handleTimeUpdateThrottled);
        document.removeEventListener("keydown", handleKeyPress);
        document.removeEventListener("keyup", handleKeyUp);
      };
    }
  }, [
    handleTimeUpdate,
    handleTimeUpdateThrottled,
    toggleLoopSong,
    toggleMute,
    togglePlayPause,
    audio,
  ]);

  return (
    <PlayerContext.Provider
      value={{
        playAudioSource,
        isPlaying,
        onLoop,
        volume,
        muted,
        playNextSong,
        playPreviousSong,
        currentTime,
        duration,
        togglePlayPause,
        toggleLoopSong,
        setAudioVolume,
        playedFromAlbum,
        setPlayedFromAlbum,
        handleTimeChange,
        handleTimeUpdate,
        toggleMute,
        setAudioSource,
        setSong,
        song,
        setArtist,
        artist,
        setAlbum,
        album,
        setImageSrc,
        imageSrc,
        setSongCallback,
        addToQueue,
        bufferedTime,
        isDraggingSeekBar,
        setIsDraggingSeekBar,
        setBufferedTime,
        queue,
        setQueue,
      }}
    >
      {children}

      <div ref={youTubePlayerRef} className="hidden">
        {isYouTubeUrl && (
          <YouTubePlayer
            ref={playerRef}
            url={audioSource}
            isPlaying={isPlaying}
            volume={volume}
            currentTime={currentTime}
            onProgress={(state) => {
              if (!isDraggingSeekBar && !isUserSeeking.current) {
                const timeDiff = Math.abs(
                  state.playedSeconds - lastReportedTime.current
                );
                if (timeDiff > 0.5) {
                  setCurrentTime(state.playedSeconds);
                  setBufferedTime(state.loadedSeconds);
                  lastReportedTime.current = state.playedSeconds;
                }
              }
            }}
            onDuration={(duration) => setDuration(duration)}
            onEnded={playNextSong}
          />
        )}
      </div>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (context === null) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
}
