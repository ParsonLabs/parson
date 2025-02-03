"use client"

import { Button } from "@music/ui/components/button";
import { HistoryIcon, Home, Compass, LibraryBig, Users } from "lucide-react";
import Link from "next/link";
import { ReactNode, useContext, useEffect, useState } from "react";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { ScrollContext } from "../Providers/ScrollProvider";
import { useSidebar } from "../Providers/SideBarProvider";
import { usePathname } from "next/navigation";

type SidebarProps = {
  children: ReactNode,
  sidebarContent: ReactNode
}

const navigationItems = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/explore', icon: Compass, label: 'Explore' },
  { href: '/social', icon: Users, label: 'Social' },
  { href: '/history', icon: HistoryIcon, label: 'History' },
  { href: '/l', icon: LibraryBig, label: 'Library' },
];

export default function Sidebar({ children, sidebarContent }: SidebarProps) {
  const { isOpen, closeSidebar, openSidebar } = useSidebar();
  const { onTopOfPage } = useContext(ScrollContext);
  const { areLyricsVisible } = useContext(LyricsContext);
  const pathname = usePathname();
  const [currentPath, setCurrentPath] = useState<string | null>(null);

  useEffect(() => {
    setCurrentPath(pathname);
  }, [pathname]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        closeSidebar();
      }
    };

    window.addEventListener('resize', handleResize);

    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [closeSidebar, openSidebar]);

  if (currentPath === null) {
    return null;
  }

  return (
    <div className="flex">
      <aside className={`hidden md:block z-40 fixed h-full 
        ${onTopOfPage || areLyricsVisible 
          ? "" 
          : "border-r border-gray-500 bg-black"} 
        ${isOpen ? "w-1/5 xl:w-[18%]" : "w-3 xl:w-20"} 
        space-y-4 p-4 lg:block pt-20 transition-colors duration-100`}>
        
        {navigationItems.map((item) => (
          <Button 
            key={item.href}
            variant="ghost" 
            asChild 
            size={isOpen ? "default" : "icon"} 
            className={`w-full flex items-center justify-start ${!isOpen && "h-12 w-12 flex-col items-center justify-center"}`}
          >
            <Link href={item.href}>
              <div className={`flex ${isOpen ? "flex-row" : "flex-col"} items-center text-white text-semibold`} 
                style={{ mixBlendMode: 'difference', pointerEvents: 'none' }}>
                <item.icon className={`h-6 w-6 ${isOpen && "mr-4"}`} />
                <span className="block mt-1">{item.label}</span>
              </div>
            </Link>
          </Button>
        ))}

        <Button 
          variant="ghost" 
          asChild 
          size={isOpen ? "default" : "icon"} 
          className={`w-full flex items-center justify-start ${!isOpen && "h-12 w-12 flex-col items-center justify-center"}`}
        >
        </Button>

        {isOpen && sidebarContent}
      </aside>
  
      <div className={`overflow-x-auto flex-grow ${isOpen ? "ml-[20%] md:ml-[19%]" : "ml-[4%] md:ml-28 mt-5"}`}>
        {children}
      </div>
    </div>
  );
};