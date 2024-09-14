"use client"

import pl from "@/assets/pl-tp.png";
import { Button } from '@music/ui/components/button';
import { Menu } from 'lucide-react';
import Image from 'next/image';
import Link from "next/link";
import { useContext, useState } from 'react';
import { LyricsContext } from '../Lyrics/LyricsOverlayContext';
import { ScrollContext } from '../Providers/ScrollProvider';
import { useSidebar } from '../Providers/SideBarProvider';
import SearchBar from "../Search/SearchBar";
import NavbarProfilePicture from '../User/NavbarProfilePicture';

export default function NavBar() {
  const [isSearchActive, setIsSearchActive] = useState(false);
  const { onTopOfPage } = useContext(ScrollContext)
  const { areLyricsVisible, setLyricsVisible } = useContext(LyricsContext)
  const { toggleSidebar } = useSidebar()

  return (
    <nav className={`fixed w-full top-0 p-4 flex items-center justify-between gap-2 box-border h-16 transition-colors duration-200 ${onTopOfPage || areLyricsVisible ? "bg-transparent" : "bg-black border-b border-gray-500"}  ${isSearchActive && 'items-stretch'}`}>
      <div className={`${isSearchActive ? 'hidden' : 'flex'} md:flex items-center`}>
        <Button onClick={toggleSidebar} variant="ghost" className="pr-4">
          <Menu />
        </Button>
        <div className="flex items-center">
          <Image src={pl} alt="alt" className="mr-2" width={25} height={25}/>
          <Link href="/home" onClick={() => setLyricsVisible(false)}>
            <div className="md:text-lg text-white font-bold hover:text-gray-300">
              ParsonLabs Music
            </div>
          </Link>
        </div>
      </div>
  
      <SearchBar isSearchActive={isSearchActive} setIsSearchActive={setIsSearchActive} />
  
      <div className={`${isSearchActive ? 'hidden' : 'flex'} gap-3 md:flex ${(onTopOfPage || areLyricsVisible) && "opacity-35"}`}>
        <NavbarProfilePicture />
      </div>
    </nav>
  );
}