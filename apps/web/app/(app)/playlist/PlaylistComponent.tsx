"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { usePlayer } from "@/components/Music/Player/usePlayer";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import { Avatar, AvatarFallback } from "@music/ui/components/avatar";
import { cn } from "@music/ui/lib/utils";
import { getPlaylist, getSongInfo, getUserInfoById } from "@music/sdk";
import {
  Album,
  Artist,
  LibrarySong,
  Playlist as OriginalPlaylist,
} from "@music/sdk/types";
import DeletePlaylistButton from "@/components/Music/Playlist/DeletePlaylistButton";
import PlaylistCard from "@/components/Music/Playlist/PlaylistCard";
import SongContextMenu from "@/components/Music/SongContextMenu";
import getBaseURL from "@/lib/Server/getBaseURL";
import PlaylistCoverGrid from "@/components/Playlist/PlaylistCoverGrid";
import { motion } from "framer-motion";
import { Button } from "@music/ui/components/button";
import {
  Search,
  Filter,
  Clock,
  MoreHorizontal,
  Heart,
  Shuffle,
  Share2,
  SortAsc,
  SortDesc,
  Music,
  Pause,
  Play,
  RotateCw,
  Calendar,
  ArrowDownUp,
  ChevronDown,
  ListFilter,
  X,
  Download,
  ListPlus,
  Check,
} from "lucide-react";
import { Input } from "@music/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@music/ui/components/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@music/ui/components/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@music/ui/components/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@music/ui/components/select";
import { Badge } from "@music/ui/components/badge";
import { Switch } from "@music/ui/components/switch";
import { Label } from "@music/ui/components/label";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@music/ui/components/tabs";

interface Playlist extends OriginalPlaylist {
  users: { id: number; username: string }[];
  createdAt: Date;
  updatedAt: Date;
}

type LibrarySongWithDate = LibrarySong & { date_added: string };

export default function PlaylistComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");
  const {
    song: currentSong,
    isPlaying,
    setImageSrc,
    setSong,
    setAudioSource,
    setArtist,
    setAlbum,
    playAudioSource
  } = usePlayer();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songsWithMetadata, setSongsWithMetadata] = useState<
    LibrarySongWithDate[]
  >([]);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [isHovered, setIsHovered] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<
    "date_added" | "title" | "artist" | "album" | "duration"
  >("date_added");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showFilters, setShowFilters] = useState(false);
  const [likedSongs, setLikedSongs] = useState<Set<string>>(new Set());
  const [showLikedOnly, setShowLikedOnly] = useState(false);
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    index: true,
    album: true,
    dateAdded: true,
    duration: true,
  });
  const [appliedFilters, setAppliedFilters] = useState<{
    artists: string[];
    albums: string[];
    duration: [number, number] | null;
  }>({
    artists: [],
    albums: [],
    duration: null,
  });

  useEffect(() => {
    async function fetchPlaylistData() {
      if (!id) return;

      const playlistData = await getPlaylist(Number(id));
      const users = await Promise.all(
        playlistData.user_ids.map(async (userId: number) => {
          const userInfo = await getUserInfoById(userId);
          return { id: userInfo.id, username: userInfo.username };
        })
      );

      setPlaylist({
        ...playlistData,
        users,
        createdAt: new Date(playlistData.created_at),
        updatedAt: new Date(playlistData.updated_at),
      });

      const songsWithMetadataPromises = playlistData.song_infos.map(
        async (songInfo: { song_id: string; date_added: string }) => {
          const songData = await getSongInfo(songInfo.song_id, false);
          return { ...songData, date_added: songInfo.date_added };
        }
      );

      const songsWithMetadataData = await Promise.all(
        songsWithMetadataPromises
      );
      setSongsWithMetadata(songsWithMetadataData as LibrarySongWithDate[]);

      const totalDuration = songsWithMetadataData.reduce(
        (total, song) => total + song.duration,
        0
      );
      setTotalDuration(totalDuration);
    }

    fetchPlaylistData();
  }, [id]);

  function formatDuration(duration: number) {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.round(duration % 60);

    let result = "";
    if (hours > 0) result += `${hours} Hour${hours > 1 ? "s" : ""} `;
    if (minutes > 0) result += `${minutes} Minute${minutes > 1 ? "s" : ""} `;
    if (seconds > 0) result += `${seconds} Second${seconds > 1 ? "s" : ""}`;
    return result.trim();
  }

  // function handlePlay(
  //   coverUrl: string,
  //   song: LibrarySong,
  //   streamUrl: string,
  //   artist: Artist,
  //   album: Album
  // ) {
  //   setImageSrc(coverUrl);
  //   setSong(song);
  //   setAudioSource(streamUrl);
  //   setArtist(artist);
  //   setAlbum(album);
  //   playAudioSource() 
  // }
  async function handlePlay(
    coverUrl: string,
    song: LibrarySong,
    streamUrl: string,
    artist: Artist,
    album: Album
  ) {
    setImageSrc(coverUrl);
    setArtist(artist);
    setAlbum(album);
    try {
      const songInfo = await getSongInfo(song.id);
      setSong(songInfo);
      setAudioSource(streamUrl);
      playAudioSource()
      
    } catch (error) {
      console.error("Failed to fetch song info:", error);
    }
  }
  
  /*
  async function handlePlay() {
    setImageSrc(imageSrc);
    setArtist(artist);
    setAlbum(album);
    try {
      const songInfo = await getSongInfo(song_id);
      setSong(songInfo);
      setAudioSource(songURL);
      setPlayedFromAlbum(false);
      playAudioSource()
      
    } catch (error) {
      console.error("Failed to fetch song info:", error);
    }
  }
  */

  const filteredAndSortedSongs = useMemo(() => {
    let filtered = [...songsWithMetadata];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (song) =>
          song.name.toLowerCase().includes(query) ||
          song.artist_object.name.toLowerCase().includes(query) ||
          song.album_object.name.toLowerCase().includes(query)
      );
    }

    if (showLikedOnly) {
      filtered = filtered.filter((song) => likedSongs.has(song.id));
    }

    if (appliedFilters.artists.length > 0) {
      filtered = filtered.filter((song) =>
        appliedFilters.artists.includes(song.artist_object.id.toString())
      );
    }

    if (appliedFilters.albums.length > 0) {
      filtered = filtered.filter((song) =>
        appliedFilters.albums.includes(song.album_object.id.toString())
      );
    }

    if (appliedFilters.duration) {
      const [min, max] = appliedFilters.duration;
      filtered = filtered.filter(
        (song) => song.duration >= min && song.duration <= max
      );
    }

    return filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "title":
          comparison = a.name.localeCompare(b.name);
          break;
        case "artist":
          comparison = a.artist_object.name.localeCompare(b.artist_object.name);
          break;
        case "album":
          comparison = a.album_object.name.localeCompare(b.album_object.name);
          break;
        case "duration":
          comparison = a.duration - b.duration;
          break;
        case "date_added":
        default:
          comparison =
            new Date(a.date_added).getTime() - new Date(b.date_added).getTime();
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [
    songsWithMetadata,
    searchQuery,
    sortBy,
    sortDirection,
    showLikedOnly,
    likedSongs,
    appliedFilters,
  ]);

  const toggleSongSelection = (songId: string) => {
    if (!isMultiSelect) return;

    setSelectedSongs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  };

  const toggleLikeSong = (e: React.MouseEvent, songId: string) => {
    e.stopPropagation();
    setLikedSongs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  };

  const performBulkAction = (
    action: "like" | "unlike" | "remove" | "download"
  ) => {
    switch (action) {
      case "like":
        setLikedSongs((prev) => {
          const newSet = new Set(prev);
          selectedSongs.forEach((id) => newSet.add(id));
          return newSet;
        });
        break;
      case "unlike":
        setLikedSongs((prev) => {
          const newSet = new Set(prev);
          selectedSongs.forEach((id) => newSet.delete(id));
          return newSet;
        });
        break;
      case "remove":
        break;
      case "download":
        break;
    }
  };

  const sharePlaylist = () => {
    if (!playlist) return;
    const url = `${window.location.origin}/playlist?id=${playlist.id}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        console.log("Playlist URL copied to clipboard");
      })
      .catch((err) => {
        console.error("Failed to copy URL: ", err);
      });
  };

  const resetFilters = () => {
    setSearchQuery("");
    setSortBy("date_added");
    setSortDirection("asc");
    setShowLikedOnly(false);
    setAppliedFilters({
      artists: [],
      albums: [],
      duration: null,
    });
  };

  function formatShortTime(duration: number) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  }

  function formatDateAdded(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  if (!playlist) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <div className="animate-pulse flex flex-col items-center space-y-6">
          <div className="w-48 h-48 rounded-lg bg-neutral-800"></div>
          <div className="w-56 h-8 bg-neutral-800 rounded"></div>
          <div className="w-80 h-4 bg-neutral-800 rounded"></div>
          <div className="w-full max-w-2xl space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-neutral-800/50 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const sortedSongs = [...songsWithMetadata].sort(
    (a, b) =>
      new Date(a.date_added).getTime() - new Date(b.date_added).getTime()
  );

  const dominantColor =
    sortedSongs.length > 0
      ? "from-purple-900/40 to-neutral-900/95"
      : "from-neutral-800/40 to-neutral-900/95";

  return (
    <ScrollArea className="h-full overflow-x-hidden overflow-y-auto">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`relative min-h-[380px] px-6 md:px-8 pt-24 pb-16 g-gradient-to-b ${dominantColor}`}
      >
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="grid grid-cols-1 md:grid-cols-[auto,1fr,auto] gap-8 items-center"
          >
            <div className="flex justify-center">
              <motion.div
                whileHover={{ scale: 1.03 }}
                transition={{ duration: 0.2 }}
                className="relative group"
                onClick={() => {
                  const firstSong = filteredAndSortedSongs[0];
                  if (filteredAndSortedSongs.length > 0 && firstSong?.album_object) {
                    handlePlay(
                      firstSong.album_object.cover_url,
                      firstSong,
                      `${getBaseURL()}/api/stream/${encodeURIComponent(firstSong.path)}?bitrate=0`,
                      firstSong.artist_object,
                      firstSong.album_object
                    );
                  }
                }}
              >
                <div
                  className="absolute inset-0 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 blur-xl -z-10 transform scale-110 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  aria-hidden="true"
                />

                <div className="w-48 h-48 md:w-56 md:h-56 rounded-xl overflow-hidden shadow-xl shadow-black/30 relative border border-white/5 group-hover:border-white/10 transition-all duration-300">
                  <PlaylistCoverGrid playlistId={playlist.id} />

                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="p-4 rounded-full bg-green-500/90 shadow-lg transform group-hover:scale-110 transition-transform duration-200">
                      <Play
                        className="w-10 h-10 text-white fill-white"
                        fill="white"
                        strokeWidth={1}
                      />
                    </div>
                  </div>
                </div>

                <div
                  className="absolute -bottom-8 left-0 right-0 h-8 bg-gradient-to-b from-black/40 to-transparent blur-sm opacity-30 rounded-b-xl mx-4 hidden md:block"
                  aria-hidden="true"
                />
              </motion.div>
            </div>
            <div className="flex flex-col gap-4">
              <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <p className="text-sm font-medium text-neutral-400 uppercase tracking-wider">
                  Playlist
                </p>
                <h1 className="text-4xl md:text-6xl font-bold mt-2 text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-300">
                  {playlist.name}
                </h1>
              </motion.div>

              <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="flex flex-wrap items-center gap-4 text-sm text-neutral-300"
              >
                <div className="flex items-center">
                  <div className="flex -space-x-2 mr-2">
                    {playlist.users.map((user) => (
                      <Avatar
                        key={user.id}
                        className="w-6 h-6 ring-2 ring-black"
                      >
                        <AvatarFallback className="bg-gradient-to-br from-purple-700 to-purple-900 text-xs">
                          {(user.username?.[0] ?? 'U').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                  <span className="font-medium">
                    {playlist.users.map((user) => user.username).join(", ")}
                  </span>
                </div>
                <span className="text-gray-500">•</span>
                <span>{filteredAndSortedSongs.length} songs</span>
                <span className="text-gray-500">•</span>
                <span>
                  {formatDuration(
                    filteredAndSortedSongs.reduce(
                      (total, song) => total + song.duration,
                      0
                    )
                  )}
                </span>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="flex items-start gap-2"
            >
              {id && <DeletePlaylistButton playlistID={id} />}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="flex flex-wrap gap-3 mt-8"
          >
            <Button
              className="bg-green-500 hover:bg-green-600 text-white rounded-full h-12 px-10 flex items-center gap-2 shadow-lg"
              onClick={() => {
                if (filteredAndSortedSongs.length > 0) {
                  const firstSong = filteredAndSortedSongs[0];
                  if (firstSong && firstSong.album_object) {
                    handlePlay(
                      firstSong.album_object.cover_url,
                      firstSong,
                      `${getBaseURL()}/api/stream/${encodeURIComponent(firstSong.path)}?bitrate=0`,
                      firstSong.artist_object,
                      firstSong.album_object
                    );
                  }
                }
              }}
            >
              <Play
                className="w-5 h-5 fill-white"
                fill="white"
                strokeWidth={0}
              />
              Play
            </Button>

            <Button
              variant="outline"
              className="rounded-full h-12 px-6 border-neutral-700 text-white hover:bg-white/10 flex items-center gap-2"
            >
              <Shuffle className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-12 w-12 text-neutral-400 hover:text-white"
            >
              <Heart className="w-5 h-5" />
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-12 w-12 text-neutral-400 hover:text-white hover:bg-white/5"
                  onClick={sharePlaylist}
                >
                  <Share2 className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Copy link to playlist</p>
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-12 w-12 text-neutral-400 hover:text-white hover:bg-white/5"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-zinc-900 border-zinc-800 w-56"
              >
                <DropdownMenuItem className="cursor-pointer focus:bg-white/10">
                  <ListPlus className="w-4 h-4 mr-2" />
                  Add to another playlist
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer focus:bg-white/10">
                  <Download className="w-4 h-4 mr-2" />
                  Download playlist
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-800" />
                <DropdownMenuItem className="cursor-pointer focus:bg-white/10 text-red-400 focus:text-red-400">
                  <X className="w-4 h-4 mr-2" />
                  Delete playlist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </motion.div>
        </div>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="mt-8 px-6 md:px-8 max-w-7xl mx-auto"
      >
        <div className="bg-black/50 backdrop-blur-md rounded-md flex flex-col border border-white/5 shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 p-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <Input
                placeholder="Search in playlist"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 py-1.5 h-9 bg-zinc-900/80 border-none focus-visible:ring-1 focus-visible:ring-green-500/50 text-sm rounded-md"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 text-zinc-400 hover:text-white"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9 bg-zinc-900/80 border-none hover:bg-zinc-800 text-zinc-300 px-3"
                  >
                    <ArrowDownUp className="h-3.5 w-3.5 text-zinc-400 mr-2" />
                    <span className="text-sm">Sort</span>
                    {sortBy !== "date_added" && (
                      <Badge variant="secondary" className="ml-1.5 px-1 py-0 bg-zinc-800 text-white text-xs">
                        {sortBy.replace('_', ' ')}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-zinc-900 border-zinc-800 shadow-xl shadow-black/20"
                >
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={cn(
                      "flex justify-between gap-4",
                      sortBy === "title" && "bg-white/10"
                    )}
                    onClick={() => {
                      setSortBy("title");
                      if (sortBy === "title")
                        setSortDirection((prev) =>
                          prev === "asc" ? "desc" : "asc"
                        );
                    }}
                  >
                    Title
                    {sortBy === "title" &&
                      (sortDirection === "asc" ? (
                        <SortAsc className="h-4 w-4" />
                      ) : (
                        <SortDesc className="h-4 w-4" />
                      ))}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "flex justify-between gap-4",
                      sortBy === "artist" && "bg-white/10"
                    )}
                    onClick={() => {
                      setSortBy("artist");
                      if (sortBy === "artist")
                        setSortDirection((prev) =>
                          prev === "asc" ? "desc" : "asc"
                        );
                    }}
                  >
                    Artist
                    {sortBy === "artist" &&
                      (sortDirection === "asc" ? (
                        <SortAsc className="h-4 w-4" />
                      ) : (
                        <SortDesc className="h-4 w-4" />
                      ))}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "flex justify-between gap-4",
                      sortBy === "album" && "bg-white/10"
                    )}
                    onClick={() => {
                      setSortBy("album");
                      if (sortBy === "album")
                        setSortDirection((prev) =>
                          prev === "asc" ? "desc" : "asc"
                        );
                    }}
                  >
                    Album
                    {sortBy === "album" &&
                      (sortDirection === "asc" ? (
                        <SortAsc className="h-4 w-4" />
                      ) : (
                        <SortDesc className="h-4 w-4" />
                      ))}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "flex justify-between gap-4",
                      sortBy === "duration" && "bg-white/10"
                    )}
                    onClick={() => {
                      setSortBy("duration");
                      if (sortBy === "duration")
                        setSortDirection((prev) =>
                          prev === "asc" ? "desc" : "asc"
                        );
                    }}
                  >
                    Duration
                    {sortBy === "duration" &&
                      (sortDirection === "asc" ? (
                        <SortAsc className="h-4 w-4" />
                      ) : (
                        <SortDesc className="h-4 w-4" />
                      ))}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(
                      "flex justify-between gap-4",
                      sortBy === "date_added" && "bg-white/10"
                    )}
                    onClick={() => {
                      setSortBy("date_added");
                      if (sortBy === "date_added")
                        setSortDirection((prev) =>
                          prev === "asc" ? "desc" : "asc"
                        );
                    }}
                  >
                    Date Added
                    {sortBy === "date_added" &&
                      (sortDirection === "asc" ? (
                        <SortAsc className="h-4 w-4" />
                      ) : (
                        <SortDesc className="h-4 w-4" />
                      ))}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 bg-zinc-900/80 border-none hover:bg-zinc-800 text-zinc-300 px-3"
                  >
                    <Filter className="h-3.5 w-3.5 text-zinc-400 mr-2" />
                    <span className="text-sm">Filter</span>
                    {(appliedFilters.artists.length > 0 ||
                      appliedFilters.albums.length > 0 ||
                      appliedFilters.duration ||
                      showLikedOnly) && (
                      <Badge className="bg-green-600 ml-1.5 px-1 py-0 text-white text-xs">
                        {
                          [
                            appliedFilters.artists.length > 0 ? "Artist" : null,
                            appliedFilters.albums.length > 0 ? "Album" : null,
                            appliedFilters.duration ? "Duration" : null,
                            showLikedOnly ? "Liked" : null,
                          ].filter(Boolean).length
                        }
                      </Badge>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md">
                  <DialogHeader>
                    <DialogTitle>Filter Songs</DialogTitle>
                    <DialogDescription>
                      Customize your playlist view
                    </DialogDescription>
                  </DialogHeader>

                  <Tabs defaultValue="filters" className="mt-2">
                    <TabsList className="bg-zinc-800">
                      <TabsTrigger value="filters">Filters</TabsTrigger>
                      <TabsTrigger value="columns">Display Columns</TabsTrigger>
                    </TabsList>

                    <TabsContent value="filters" className="pb-4">
                      <div className="space-y-5 mt-4">
                        <div className="flex items-center justify-between">
                          <Label
                            htmlFor="liked-only"
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <Heart
                              className="h-4 w-4 text-red-500"
                              fill={showLikedOnly ? "currentColor" : "none"}
                            />
                            <span>Show liked songs only</span>
                          </Label>
                          <Switch
                            id="liked-only"
                            checked={showLikedOnly}
                            onCheckedChange={setShowLikedOnly}
                          />
                        </div>

                        <div>
                          <Label className="mb-2 block">
                            Filter by artists
                          </Label>
                          <div className="max-h-36 overflow-y-auto pr-2 space-y-2">
                            {Array.from(
                              new Set(
                                songsWithMetadata.map((song) =>
                                  JSON.stringify({
                                    id: song.artist_object.id,
                                    name: song.artist_object.name,
                                  })
                                )
                              )
                            ).map((artistStr) => {
                              const artist = JSON.parse(artistStr);
                              const isSelected =
                                appliedFilters.artists.includes(
                                  artist.id.toString()
                                );

                              return (
                                <div
                                  key={`artist-${artist.id}`}
                                  className="flex items-center gap-2"
                                  onClick={() =>
                                    setAppliedFilters((prev) => {
                                      const newArtists = isSelected
                                        ? prev.artists.filter(
                                            (id) => id !== artist.id.toString()
                                          )
                                        : [
                                            ...prev.artists,
                                            artist.id.toString(),
                                          ];
                                      return { ...prev, artists: newArtists };
                                    })
                                  }
                                >
                                  <div
                                    className={`w-4 h-4 rounded ${isSelected ? "bg-purple-600" : "border border-gray-500"} flex items-center justify-center text-white`}
                                  >
                                    {isSelected && (
                                      <Check className="h-3 w-3" />
                                    )}
                                  </div>
                                  <span className="text-sm text-gray-200">
                                    {artist.name}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <Label className="mb-2 block">Filter by albums</Label>
                          <div className="max-h-36 overflow-y-auto pr-2 space-y-2">
                            {Array.from(
                              new Set(
                                songsWithMetadata.map((song) =>
                                  JSON.stringify({
                                    id: song.album_object.id,
                                    name: song.album_object.name,
                                  })
                                )
                              )
                            ).map((albumStr) => {
                              const album = JSON.parse(albumStr);
                              const isSelected = appliedFilters.albums.includes(
                                album.id.toString()
                              );

                              return (
                                <div
                                  key={`album-${album.id}`}
                                  className="flex items-center gap-2"
                                  onClick={() =>
                                    setAppliedFilters((prev) => {
                                      const newAlbums = isSelected
                                        ? prev.albums.filter(
                                            (id) => id !== album.id.toString()
                                          )
                                        : [...prev.albums, album.id.toString()];
                                      return { ...prev, albums: newAlbums };
                                    })
                                  }
                                >
                                  <div
                                    className={`w-4 h-4 rounded ${isSelected ? "bg-purple-600" : "border border-gray-500"} flex items-center justify-center text-white`}
                                  >
                                    {isSelected && (
                                      <Check className="h-3 w-3" />
                                    )}
                                  </div>
                                  <span className="text-sm text-gray-200">
                                    {album.name}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="columns" className="pb-4">
                      <div className="space-y-4 mt-4">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="col-index" className="cursor-pointer">
                            Show # Column
                          </Label>
                          <Switch
                            id="col-index"
                            checked={visibleColumns.index}
                            onCheckedChange={(checked) =>
                              setVisibleColumns({
                                ...visibleColumns,
                                index: checked,
                              })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="col-album" className="cursor-pointer">
                            Show Album Column
                          </Label>
                          <Switch
                            id="col-album"
                            checked={visibleColumns.album}
                            onCheckedChange={(checked) =>
                              setVisibleColumns({
                                ...visibleColumns,
                                album: checked,
                              })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="col-date" className="cursor-pointer">
                            Show Date Added Column
                          </Label>
                          <Switch
                            id="col-date"
                            checked={visibleColumns.dateAdded}
                            onCheckedChange={(checked) =>
                              setVisibleColumns({
                                ...visibleColumns,
                                dateAdded: checked,
                              })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label
                            htmlFor="col-duration"
                            className="cursor-pointer"
                          >
                            Show Duration Column
                          </Label>
                          <Switch
                            id="col-duration"
                            checked={visibleColumns.duration}
                            onCheckedChange={(checked) =>
                              setVisibleColumns({
                                ...visibleColumns,
                                duration: checked,
                              })
                            }
                          />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>

                  <DialogFooter className="border-t border-zinc-800 pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetFilters}
                      className="mr-auto"
                    >
                      <RotateCw className="h-3.5 w-3.5 mr-1" />
                      Reset All
                    </Button>
                    <Button type="submit" onClick={() => {}}>
                      Apply
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                variant={isMultiSelect ? "default" : "secondary"}
                size="sm"
                onClick={() => setIsMultiSelect(!isMultiSelect)}
                className={
                  isMultiSelect 
                    ? "bg-green-600 hover:bg-green-700 text-white h-9 px-3" 
                    : "bg-zinc-900/80 border-none hover:bg-zinc-800 text-zinc-300 h-9 px-3"
                }
              >
                <ListFilter className="h-3.5 w-3.5 mr-2" />
                <span className="text-sm">Select</span>
              </Button>
            </div>
          </div>

          {(appliedFilters.artists.length > 0 ||
            appliedFilters.albums.length > 0 ||
            showLikedOnly ||
            searchQuery) && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 bg-black/30 border-t border-white/5">
              {searchQuery && (
                <Badge
                  variant="outline"
                  className="bg-zinc-800/80 gap-1 pl-2 pr-1 py-0.5 text-xs text-zinc-300 border-zinc-700 flex items-center"
                >
                  Search: {searchQuery.length > 15 ? `${searchQuery.substring(0, 15)}...` : searchQuery}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-1 p-0 hover:bg-zinc-700 rounded-full"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              )}

              {showLikedOnly && (
                <Badge
                  variant="outline"
                  className="bg-zinc-800/80 gap-1 pl-2 pr-1 py-0.5 text-xs text-zinc-300 border-zinc-700 flex items-center"
                >
                  Liked Only
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-1 p-0 hover:bg-zinc-700 rounded-full"
                    onClick={() => setShowLikedOnly(false)}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              )}

              {appliedFilters.artists.length > 0 && (
                <Badge
                  variant="outline"
                  className="bg-zinc-800/80 gap-1 pl-2 pr-1 py-0.5 text-xs text-zinc-300 border-zinc-700 flex items-center"
                >
                  Artists: {appliedFilters.artists.length}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-1 p-0 hover:bg-zinc-700 rounded-full"
                    onClick={() => setAppliedFilters(prev => ({...prev, artists: []}))}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              )}
              
              {appliedFilters.albums.length > 0 && (
                <Badge
                  variant="outline"
                  className="bg-zinc-800/80 gap-1 pl-2 pr-1 py-0.5 text-xs text-zinc-300 border-zinc-700 flex items-center"
                >
                  Albums: {appliedFilters.albums.length}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-1 p-0 hover:bg-zinc-700 rounded-full"
                    onClick={() => setAppliedFilters(prev => ({...prev, albums: []}))}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              )}

              {(appliedFilters.artists.length > 0 ||
                appliedFilters.albums.length > 0 ||
                showLikedOnly) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-5 px-2 text-neutral-400 hover:text-white"
                  onClick={resetFilters}
                >
                  Clear all
                </Button>
              )}
            </div>
          )}

          {isMultiSelect && selectedSongs.size > 0 && (
            <div className="flex items-center gap-2 p-2 bg-black/30 border-t border-white/5">
              <Badge className="bg-purple-600">
                {selectedSongs.size} selected
              </Badge>

              <div className="flex items-center gap-1 ml-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full h-7 w-7 p-0"
                        onClick={() => performBulkAction("like")}
                      >
                        <Heart className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Like selected</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full h-7 w-7 p-0"
                        onClick={() => performBulkAction("download")}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download selected</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                        onClick={() => performBulkAction("remove")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove from playlist</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 text-neutral-400 hover:text-white ml-2"
                  onClick={() => setSelectedSongs(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      <div className="px-6 md:px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-[48px,1fr,auto] items-center py-4 px-4 border-b border-white/5 text-neutral-400 text-xs font-medium uppercase tracking-wider">
          <div className="text-center">#</div>
          <div>Title</div>
          <div className="flex items-center gap-2 pr-4">
            <Clock className="w-4 h-4" />
          </div>
        </div>

        <div className="flex flex-col pb-36">
          {sortedSongs.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <p>This playlist is empty</p>
              <p className="mt-2 text-sm">Add some songs to get started</p>
            </div>
          ) : (
            filteredAndSortedSongs.map((song, index) => (
              <motion.div
                key={song.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.03 }}
              >
                <SongContextMenu
                  song_name={song.name}
                  song_id={song.id}
                  artist_id={song.artist_object.id}
                  artist_name={song.artist_object.name}
                  album_id={song.album_object.id}
                  album_name={song.album_object.name}
                >
                  <div
                    onMouseEnter={() => setIsHovered(song.id)}
                    onMouseLeave={() => setIsHovered(null)}
                    onClick={() =>
                      handlePlay(
                        song.album_object.cover_url,
                        song,
                        `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=0`,
                        song.artist_object,
                        song.album_object
                      )
                    }
                    className={cn(
                      "grid grid-cols-[48px,1fr,auto] items-center p-3 rounded-lg transition-all duration-200 hover:bg-white/10 cursor-pointer group",
                      currentSong.id === song.id ? "bg-white/20" : ""
                    )}
                  >
                    <div className="font-medium text-gray-200 relative w-12 flex items-center justify-center">
                      {isHovered === song.id || currentSong.id === song.id ? (
                        <div className="flex items-center justify-center">
                          {currentSong.id === song.id && isPlaying ? (
                            <Pause
                              className="w-5 h-5 text-white fill-white"
                              fill="white"
                              strokeWidth={0}
                            />
                          ) : (
                            <Play
                              className="w-5 h-5 text-white fill-white"
                              fill="white"
                              strokeWidth={0}
                            />
                          )}
                        </div>
                      ) : (
                        <span
                          className={cn(
                            "text-sm opacity-50 group-hover:opacity-0 transition-opacity",
                            currentSong.id === song.id
                              ? "text-green-500 font-bold"
                              : ""
                          )}
                        >
                          {index + 1}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <PlaylistCard
                        song={song}
                        coverURL={song.album_object.cover_url}
                        artist={song.artist_object}
                        album={song.album_object}
                        showCover={true}
                        showArtist={true}
                      />
                    </div>

                    <div className="text-right text-neutral-400 text-sm px-4 flex items-center gap-2">
                      {currentSong.id !== song.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full h-8 w-8 text-neutral-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLikeSong(e, song.id);
                          }}
                        >
                          <Heart className="w-4 h-4" />
                        </Button>
                      )}
                      <span
                        className={
                          currentSong.id === song.id ? "text-green-400" : ""
                        }
                      >
                        {formatDuration(song.duration)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full h-8 w-8 text-neutral-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </SongContextMenu>
              </motion.div>
            ))
          )}
        </div>
      </div>
      <ScrollBar />
    </ScrollArea>
  );
}
