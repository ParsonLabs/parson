"use client"

import { 
  HistoryIcon, 
  Home, 
  Search, 
  Library, 
  Plus, 
  ArrowRight,
  ChevronLeft, 
  ChevronRight,
  ListMusic,
  Clock,
  Heart,
  Download,
  RadioIcon,
  PlusCircle,
  Loader2,
  Music,
  GripVertical
} from "lucide-react";
import Link from "next/link";
import { ReactNode, useContext, useEffect, useState, useRef } from "react";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { ScrollContext } from "../Providers/ScrollProvider";
import { useSidebar } from "../Providers/SideBarProvider";
import { useSession } from "../Providers/AuthProvider";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import Image from "next/image";
import { ScrollArea } from "@music/ui/components/scroll-area";
import { Button } from "@music/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import getBaseURL from "@/lib/Server/getBaseURL";
import { cn } from "@music/ui/lib/utils";
import { getPlaylists } from "@music/sdk";
import CreatePlaylistDialog from "../Music/Playlist/CreatePlaylistDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@music/ui/components/tooltip";
import PlaylistCoverGrid from "../Playlist/PlaylistCoverGrid";

type SidebarProps = {
  children: ReactNode,
  sidebarContent: ReactNode
}

const mainNavItems = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/search', icon: Search, label: 'Search' },
];

const libraryItems = [
  { href: '/l/playlists', icon: ListMusic, label: 'Playlists' },
  { href: '/l/artists', icon: RadioIcon, label: 'Artists' },
  { href: '/l/albums', icon: Library, label: 'Albums' },
  { href: '/l/liked', icon: Heart, label: 'Liked Songs' },
  { href: '/history', icon: Clock, label: 'Recently Played' },
];

const filterOptions = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
  { id: 'albums', label: 'Albums' }
];

const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;
const COLLAPSED_WIDTH = 72;

export default function Sidebar({ children, sidebarContent }: SidebarProps) {
  const { onTopOfPage } = useContext(ScrollContext);
  const { areLyricsVisible } = useContext(LyricsContext);
  const { session } = useSession();
  const pathname = usePathname();
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('playlists');
  const [showMore, setShowMore] = useState(false);
  
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const { isOpen, closeSidebar, openSidebar, toggleSidebar } = useSidebar()
  const resizingRef = useRef<boolean>(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const {
    data: playlists,
    isLoading: isLoadingPlaylists,
    error: playlistsError
  } = useQuery({
    queryKey: ['userPlaylists', session?.sub],
    queryFn: () => getPlaylists(Number(session?.sub)),
    enabled: !!session?.sub,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setCurrentPath(pathname);
  }, [pathname]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      
      const newWidth = e.clientX;
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        setSidebarWidth(newWidth);
        closeSidebar()
      }
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, closeSidebar]);

  if (currentPath === null) {
    return null;
  }

  const isActive = (path: string) => {
    return currentPath?.startsWith(path) || false;
  };

  const sidebarBackgroundClass = "bg-black/95 backdrop-blur-md shadow-lg";
  
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    setIsResizing(true);
  };

  const currentWidth = !isOpen ? COLLAPSED_WIDTH : sidebarWidth;

  const contentMargin = !isOpen ? COLLAPSED_WIDTH : sidebarWidth;

  return (
    <div className="flex">
      <motion.aside
        ref={sidebarRef}
        initial={{ x: -10, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`hidden md:block z-40 fixed h-full
          ${sidebarBackgroundClass}
          space-y-2 pt-20 transition-all duration-200`}
        style={{ width: `${currentWidth}px` }}
      >
        <div
          className={`absolute -right-1 top-0 bottom-0 w-2 cursor-ew-resize 
            hover:bg-purple-500/30 active:bg-purple-500/50 transition-colors z-40
            ${isResizing ? 'bg-purple-500/50' : 'bg-transparent'} 
            ${!isOpen ? 'hidden' : ''}`}
          onMouseDown={handleResizeStart}
          title="Resize sidebar"
        />

        <div className="px-3 mb-4">
          {mainNavItems.map((item) => {
            const active = isActive(item.href);
            
            return (
              <Link key={item.href} href={item.href}>
                {!isOpen ? (
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <motion.div
                          whileHover={{ x: 3 }}
                          whileTap={{ scale: 0.98 }}
                          className={`flex items-center gap-5 px-3 py-3 rounded-md transition-colors
                            ${active 
                              ? "bg-white/20 text-white font-medium" 
                              : "text-gray-300 hover:text-white"
                            }`}
                        >
                          <item.icon className={`h-6 w-6 ${active ? "text-white" : ""}`} />
                        </motion.div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <motion.div
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.98 }}
                    className={`flex items-center gap-5 px-3 py-3 rounded-md transition-colors
                      ${active 
                        ? "bg-white/20 text-white font-medium" 
                        : "text-gray-300 hover:text-white"
                      }`}
                  >
                    <item.icon className={`h-6 w-6 ${active ? "text-white" : ""}`} />
                    <span className="text-sm font-medium">{item.label}</span>
                  </motion.div>
                )}
              </Link>
            );
          })}
        </div>

        <div className="bg-black/30 rounded-lg mx-2 pb-2">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              {!isOpen ? (
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
                        <Library className="h-5 w-5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                      Your Library
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <div className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
                  <Library className="h-5 w-5" />
                  <span className="text-sm font-medium">Your Library</span>
                </div>
              )}
              
              {isOpen && (
                <div className="flex items-center gap-2">
                  <CreatePlaylistDialog>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-gray-300 hover:text-white bg-transparent hover:bg-white/5 rounded-full h-7 w-7"
                    >
                      <PlusCircle className="h-4 w-4" />
                    </Button>
                  </CreatePlaylistDialog>
                  
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-gray-300 hover:text-white bg-transparent hover:bg-white/5 rounded-full h-7 w-7"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="bg-zinc-800 text-white border-zinc-700">
                        Show more
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </div>

            {!!isOpen && (
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {filterOptions.map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setActiveFilter(filter.id)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs whitespace-nowrap transition-all duration-200",
                      activeFilter === filter.id 
                        ? "bg-white text-black font-semibold" 
                        : "bg-white/10 text-white hover:bg-white/20"
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ScrollArea className={`h-[calc(100vh-280px)] ${!isOpen ? 'px-1' : 'px-2'}`}>
            <div className="space-y-1">
              {libraryItems.map((item) => {
                const active = isActive(item.href);
                
                return (
                  <Link key={item.href} href={item.href} title={!isOpen ? item.label : undefined}>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`flex items-center ${!isOpen ? 'justify-center' : 'gap-3'} p-2 rounded-md transition-colors
                        ${active 
                          ? "bg-white/10 text-white" 
                          : "text-gray-300 hover:text-white hover:bg-white/5"
                        }`}
                    >
                      <div className={`flex items-center justify-center ${!isOpen ? 'w-8 h-8' : 'w-10 h-10'} rounded-md bg-gradient-to-br ${active ? "from-indigo-500 to-purple-600" : "from-gray-700 to-gray-600"}`}>
                        <item.icon className="h-5 w-5" />
                      </div>
                      
                      {!!isOpen && (
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.label}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {item.label === 'Playlists' ? 'Created by you' : 
                            item.label === 'Liked Songs' ? '142 songs' : 
                            'Library'}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  </Link>
                );
              })}

              <div className="h-px bg-white/5 my-3" />

              {isLoadingPlaylists && (
                <div className={`flex ${!isOpen ? 'justify-center' : 'flex-col items-center'} py-6 text-gray-400`}>
                  <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  {!!isOpen && <p className="text-sm">Loading playlists...</p>}
                </div>
              )}

              {playlistsError && !!isOpen && (
                <div className="flex flex-col items-center justify-center py-6 text-gray-400">
                  <p className="text-sm">Failed to load playlists</p>
                  <Button 
                    variant="link" 
                    className="text-blue-400 hover:text-blue-300 p-0 h-auto text-xs"
                  >
                    Retry
                  </Button>
                </div>
              )}

              {playlists && playlists.length > 0 && (
                <div className="space-y-1 mt-2">
                  {playlists.map((playlist) => {
                    const playlistPath = `/playlist?id=${playlist.id}`;
                    const active = currentPath === playlistPath;
                    
                    return (
                      <Link key={playlist.id} href={playlistPath}>
                        {!isOpen ? (
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <motion.div
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                  className={`flex items-center justify-center p-2 rounded-md transition-all duration-200 
                                    ${active 
                                      ? "bg-white/10 text-white" 
                                      : "text-gray-300 hover:text-white hover:bg-white/5"
                                    }`}
                                >
                                  <div className={`flex items-center justify-center w-8 h-8 rounded-md overflow-hidden bg-gradient-to-br ${active ? "from-indigo-500 to-purple-600" : "from-gray-700 to-gray-600"}`}>
                                    <PlaylistCoverGrid playlistId={playlist.id} />
                                  </div>
                                </motion.div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                                {playlist.name}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <motion.div
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className={`flex items-center gap-3 p-2 rounded-md transition-all duration-200 
                              ${active 
                                ? "bg-white/10 text-white" 
                                : "text-gray-300 hover:text-white hover:bg-white/5"
                              }`}
                          >
                            <div className={`flex items-center justify-center w-10 h-10 rounded-md overflow-hidden bg-gradient-to-br ${active ? "from-indigo-500 to-purple-600" : "from-gray-700 to-gray-600"}`}>
                                <PlaylistCoverGrid playlistId={playlist.id} />
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{playlist.name}</p>
                              <p className="text-xs text-gray-400 truncate">
                                Playlist • {playlist.id || 0} songs
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="absolute bottom-6 left-0 right-0 px-5">
          {!isOpen ? (
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-center text-gray-300 hover:text-white transition-colors cursor-pointer p-2 rounded-md hover:bg-white/5">
                    <Download className="h-5 w-5" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                  Install App
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="flex items-center gap-3 text-gray-300 hover:text-white transition-colors cursor-pointer p-2 rounded-md hover:bg-white/5">
              <Download className="h-5 w-5" />
              <span className="text-sm font-medium">Install App</span>
            </div>
          )}
        </div>
      </motion.aside>
  
      <div className="ml-0 md:ml-[72px] flex-grow transition-all duration-200" style={{ marginLeft: `${contentMargin}px` }}>
        {children}
      </div>
    </div>
  );
};