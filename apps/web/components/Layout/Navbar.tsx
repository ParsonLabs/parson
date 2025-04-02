"use client"

import { Button } from "@music/ui/components/button";
import { Bell, Menu, Search, Disc3 } from "lucide-react";
import { useContext, useEffect, useState, useRef, memo, Suspense } from "react";
import { ScrollContext } from "../Providers/ScrollProvider";
import Image from "next/image";
import pl from "@/assets/pl-tp.png";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { useSidebar } from "../Providers/SideBarProvider";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { Input } from "@music/ui/components/input";
import NavbarProfilePicture from "../User/NavbarProfilePicture";
import { usePathname } from "next/navigation";

const SearchBar = memo(() => {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams()
  const pathname = usePathname();
  const [isFocused, setIsFocused] = useState(false);
  
  const shouldHideSearch = pathname === '/search' && !searchParams.get("q")

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  if (shouldHideSearch) {
    return null;
  }

  return (
    <div className={`relative max-w-md w-full transition-all`}>
      <form onSubmit={handleSearchSubmit} className="relative">
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search for songs, artists, albums..."
          className="w-full bg-white/10 border-0 pl-10 py-2 h-10 text-sm rounded-full focus-visible:ring-1 focus-visible:ring-purple-500 text-white placeholder:text-gray-400 pr-4"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
      </form>
    </div>
  );
});

SearchBar.displayName = "SearchBar";

export default function NavBar() {
  const { onTopOfPage } = useContext(ScrollContext);
  const { areLyricsVisible } = useContext(LyricsContext);
  const { toggleSidebar } = useSidebar();
  
  const navbarBackgroundClass = !(onTopOfPage || areLyricsVisible)
    ? 'bg-black/75 backdrop-blur-md shadow-lg'
    : 'bg-gradient-to-b from-black/50 to-transparent backdrop-blur-sm';

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`fixed w-full top-0 z-50 px-4 py-3 flex items-center justify-between gap-4 h-16 transition-all duration-300 ${navbarBackgroundClass}`}
    >
      <div className="flex items-center shrink-0">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleSidebar} 
          className="mr-2 text-white hover:bg-white/10"
        >
          <Menu className="w-5 h-5" />
        </Button>
        
        <Link href="/home" className="flex items-center gap-2 pl-5">
          <Image 
            src={pl} 
            alt="ParsonLabs Music" 
            className="rounded-full" 
            width={28} 
            height={28}
          />
          <span className="font-bold text-lg text-white hidden sm:block">Music</span>
        </Link>
      </div>

      <div className="flex-1 flex justify-center items-center max-w-2xl mx-auto">
        <Suspense>
          <SearchBar />
        </Suspense>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button 
          variant="ghost" 
          size="icon" 
          className="text-white hover:bg-white/10 hidden sm:flex"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
        </Button>
        
        <NavbarProfilePicture />
      </div>
    </motion.nav>
  );
}