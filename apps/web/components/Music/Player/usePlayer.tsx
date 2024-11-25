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
  const [audioSource, setAudioSource] = useState("");
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
      featured_on_album_ids: []
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
    tadb_music_videos: undefined
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
  const [playedFromAlbum, setPlayedFromAlbum] = useState(false)

  const queueRef = useRef<Queue[]>([]);

  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [onLoop, setOnLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [base64Image, setBase64Image] = useState("");
  const [bufferedTime, setBufferedTime] = useState(0);

  const lastAddedSongIdRef = useRef<string | null>(null);

  let bitrate = 0;

  const { session } = useSession()

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
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = audioSource;
      audio.oncanplaythrough = () => {
        audio.play();
        setIsPlaying(true);
      };
    }
  }, [audioSource, audio]);

  const setQueue = useCallback((newQueue: Queue[]) => {
    queueRef.current = newQueue;
    setQueueState(newQueue);
  }, []);

  const setSongCallback = useCallback(
    async (song: LibrarySong, artist: Artist, album: Album) => {
      setSong(song);
      setArtist(artist);
      setAlbum(album);
      if (album.cover_url.length === 0) {
        setBase64Image("/snf.png");
        setImageSrc("/snf.png");
      } else {
        // imageToBase64(album.cover_url).then((base64) => {
        //   const base64Data = `data:image/jpg;base64,${base64}`;
        //   setBase64Image(base64Data);
        // });
        setImageSrc(
          `${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}`
        );
      }
      setAudioSource(
        `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${bitrate}`
      );

      const index = queueRef.current.findIndex((q) => q.song.id === song.id);
      if (index !== -1) {
        setCurrentSongIndex(index);
      }
    },
    [setSong, bitrate]
  );

  const playNextSong = useCallback(async () => {
    if (playedFromAlbum && album) {
      let nextSongIndex = album.songs.findIndex(albumSong => String(albumSong.id) === String(song.id)) + 1;
  
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
              recommendedSong = await getSongInfo(shuffledSong.id) as LibrarySong;
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
      audio.src = audioSource;
      audio.load();
      audio.oncanplaythrough = () => {
        audio.play();
        setIsPlaying(true);
      };
      audio.addEventListener("ended", playNextSong);

      if ("mediaSession" in navigator) {
        // Normalizing the path is necessary to remove the Windows long path prefix ("\\?\") if present.
        // This prefix allows Windows applications to handle paths longer than the MAX_PATH limit (260 characters),
        // but it's not recognized by web browsers or servers. Removing it ensures the path can be used in URLs
        // More Here:
        // https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation?tabs=registry
        let normalisedAlbumPath = album.cover_url.startsWith("\\\\?\\")
          ? album.cover_url.substring(4)
          : album.cover_url;
        let albumPath = `${getBaseURL()}/image/${encodeURIComponent(normalisedAlbumPath)}?raw=true`;

        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.name,
          artist: song.artist,
          album: album.name,
          artwork: [{ src: albumPath, type: "image/jpeg" }],
        });
        navigator.mediaSession.setActionHandler("play", () => audio.play());
        navigator.mediaSession.setActionHandler("pause", () => audio.pause());
        navigator.mediaSession.setActionHandler(
          "previoustrack",
          playPreviousSong
        );
        navigator.mediaSession.setActionHandler("nexttrack", playNextSong);
      }
    }

    return () => {
      audio.removeEventListener("ended", playNextSong);
    };
  }, [
    audioSource,
    audio,
    song,
    playNextSong,
    album.name,
    imageSrc,
    playPreviousSong,
    album.cover_url,
  ]);

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
    const audio = audioRef.current;
    if (audio) {
      if (isPlaying) {
        audio.pause();
      } else {
        audio.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

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

  const handleTimeChange = useCallback((value: string) => {
    let newTime = parseFloat(value);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, []);

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
        setBufferedTime,
        queue,
        setQueue,
      }}
    >
      {children}
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
