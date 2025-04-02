"use client";

import getSession from '@/lib/Authentication/JWT/getSession';
import { getProfilePicture } from '@music/sdk';
import { ScrollArea, ScrollBar } from '@music/ui/components/scroll-area';
import { ChevronLeft, ChevronRight, MoreHorizontal, Pin, Eye, EyeOff } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@music/ui/components/popover';
import { useLayoutConfig } from '../Providers/LayoutConfigContext';
import { useSession } from '../Providers/AuthProvider';
import { motion } from 'framer-motion';

type ScrollButtonsProps = {
  id?: string;
  children: React.ReactNode;
  heading: string;
  showUser?: boolean;
  topText?: string;
  imageUrl?: string;
};

export default function ScrollButtons({ id, children, heading, showUser, topText, imageUrl }: ScrollButtonsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const [canScroll, setCanScroll] = useState(false);
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const { components, setComponents } = useLayoutConfig();
  const [isHovered, setIsHovered] = useState<string | null>(null);

  const checkScrollPosition = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setIsAtStart(scrollLeft <= 10);
      setIsAtEnd(scrollLeft + clientWidth >= scrollWidth - 10);
      setCanScroll(scrollWidth > clientWidth);
    }
  }, []);

  const { session } = useSession();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const profilePictureBlob = await getProfilePicture(Number(session?.sub));
        const profilePictureUrl = URL.createObjectURL(profilePictureBlob);
        setProfilePicture(profilePictureUrl);
        setUsername(String(session?.username));
      } catch (error) {
        console.error("Failed to load profile picture:", error);
        setProfilePicture(null);
      }
    };

    if (showUser && session?.sub) {
      fetchUserData();
    }

    const currentScrollRef = scrollRef.current;
    checkScrollPosition();
    if (currentScrollRef) {
      currentScrollRef.addEventListener('scroll', checkScrollPosition);
      
      const resizeObserver = new ResizeObserver(() => {
        checkScrollPosition();
      });
      resizeObserver.observe(currentScrollRef);
      
      return () => {
        currentScrollRef.removeEventListener('scroll', checkScrollPosition);
        resizeObserver.disconnect();
      };
    }
  }, [checkScrollPosition, showUser, session?.username, session?.sub]);

  const scrollLeft = useCallback(() => {
    if (scrollRef.current) {
      const width = scrollRef.current.clientWidth;
      scrollRef.current.scrollBy({ left: -Math.min(750, width * 0.8), behavior: 'smooth' });
    }
  }, []);

  const scrollRight = useCallback(() => {
    if (scrollRef.current) {
      const width = scrollRef.current.clientWidth;
      scrollRef.current.scrollBy({ left: Math.min(750, width * 0.8), behavior: 'smooth' });
    }
  }, []);

  const handlePinToggle = () => {
    const updatedComponents = components.map((component) =>
      component.id === id ? { ...component, pinned: !component.pinned } : component
    );
    const pinnedComponents = updatedComponents.filter((component) => component.pinned);
    const unpinnedComponents = updatedComponents.filter((component) => !component.pinned);
    const newComponents = [...pinnedComponents, ...unpinnedComponents];
    setComponents(newComponents);
  };

  const handleVisibilityToggle = () => {
    const updatedComponents = components.map((component) =>
      component.id === id ? { ...component, visible: !component.visible } : component
    );
    setComponents(updatedComponents);
  };

  const currentComponent = components.find((component) => component.id === id);

  return (
    <>
      <div className="flex flex-row gap-4 justify-between items-end pb-4 mr-8 mt-6">
        <motion.div 
          className="flex flex-row items-center"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          {(showUser || imageUrl) && 
            <div className="relative mr-4">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full opacity-25 blur-sm -z-10" />
              <Image
                src={showUser && profilePicture ? profilePicture : imageUrl ?? "/snf.png"}
                alt="Profile"
                className="w-12 h-12 rounded-full object-cover shadow-md border border-white/10"
                height={200}
                width={200}
              /> 
            </div>
          }
          <div className="flex flex-col">
            <span className="text-sm md:text-base lg:text-lg text-gray-400 font-medium tracking-wider">
              {(showUser && username ? username : topText)?.toUpperCase()}
            </span>
            <h1 className="font-bold text-base md:text-2xl lg:text-3xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              {heading}
            </h1>
          </div>
        </motion.div>

        <div className="flex flex-row gap-3 items-center">
          {id && (
            <Popover>
              <PopoverTrigger asChild>
                <motion.button 
                  className={`rounded-full w-8 h-8 flex items-center justify-center transition-all duration-200
                    ${isHovered === 'options' ? 'bg-white/20 shadow-lg' : 'bg-black/30 border border-white/10'}`}
                  whileTap={{ scale: 0.9 }}
                  onMouseEnter={() => setIsHovered('options')}
                  onMouseLeave={() => setIsHovered(null)}
                >
                </motion.button>
              </PopoverTrigger>
              <PopoverContent className="text-white bg-zinc-900/90 backdrop-filter backdrop-blur-lg border border-white/10 shadow-xl rounded-xl p-4 w-56">
                <div className="flex flex-col gap-3">
                  <motion.button
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all 
                      ${currentComponent?.pinned 
                        ? 'bg-purple-500/20 text-purple-300' 
                        : 'hover:bg-white/5'}`}
                    onClick={handlePinToggle}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Pin className="w-4 h-4" />
                    {currentComponent?.pinned ? 'Unpin from Home' : 'Pin to Home'}
                  </motion.button>
                  <motion.button
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all
                      ${!currentComponent?.visible 
                        ? 'bg-purple-500/20 text-purple-300' 
                        : 'hover:bg-white/5'}`}
                    onClick={handleVisibilityToggle}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    {currentComponent?.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    {currentComponent?.visible ? 'Hide this section' : 'Show this section'}
                  </motion.button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          
          <motion.button
            className={`rounded-full w-8 h-8 flex items-center justify-center transition-all duration-200
              ${isHovered === 'left' 
                ? 'bg-white/20 shadow-lg' 
                : 'bg-black/30 border border-white/10'} 
              ${isAtStart ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/10'}`}
            onClick={scrollLeft}
            disabled={isAtStart}
            onMouseEnter={() => !isAtStart && setIsHovered('left')}
            onMouseLeave={() => setIsHovered(null)}
            whileTap={!isAtStart ? { scale: 0.9 } : {}}
          >
            <ChevronLeft className="w-4 h-4" />
          </motion.button>
          
          <motion.button
            className={`rounded-full w-8 h-8 flex items-center justify-center transition-all duration-200
              ${isHovered === 'right' 
                ? 'bg-white/20 shadow-lg' 
                : 'bg-black/30 border border-white/10'} 
              ${isAtEnd ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/10'}`}
            onClick={scrollRight}
            disabled={isAtEnd}
            onMouseEnter={() => !isAtEnd && setIsHovered('right')}
            onMouseLeave={() => setIsHovered(null)}
            whileTap={!isAtEnd ? { scale: 0.9 } : {}}
          >
            <ChevronRight className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
  
      <ScrollArea className="w-full pb-20" viewportRef={scrollRef}>
        <div className="min-h-full h-auto">{children}</div>
        <ScrollBar orientation="horizontal" className="bg-white/5" />
      </ScrollArea>
    </>
  );
}