"use client";

import getSession from '@/lib/Authentication/JWT/getSession';
import { getProfilePicture } from '@music/sdk';
import { ScrollArea, ScrollBar } from '@music/ui/components/scroll-area';
import { ChevronLeft, ChevronRight, Ellipsis, Pin, Eye, EyeOff } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@music/ui/components/popover';
import { useLayoutConfig } from '../Providers/LayoutConfigContext';
import { useSession } from '../Providers/AuthProvider';

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

  const checkScrollPosition = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setIsAtStart(scrollLeft === 0);
      setIsAtEnd(scrollLeft + clientWidth >= scrollWidth);
      setCanScroll(scrollWidth > clientWidth);
    }
  }, []);

  const { session } = useSession()

  useEffect(() => {
    const fetchUserData = async () => {
      const profilePictureBlob = await getProfilePicture(Number(session?.sub));
      const profilePictureUrl = URL.createObjectURL(profilePictureBlob);
      setProfilePicture(profilePictureUrl);
      setUsername(String(session?.username));
    };

    if (showUser) {
      fetchUserData();
    }

    const currentScrollRef = scrollRef.current;
    checkScrollPosition();
    if (currentScrollRef) {
      currentScrollRef.addEventListener('scroll', checkScrollPosition);
    }
    return () => {
      if (currentScrollRef) {
        currentScrollRef.removeEventListener('scroll', checkScrollPosition);
      }
    };
  }, [checkScrollPosition, showUser, session?.username, session?.sub]);

  const scrollLeft = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -750, behavior: 'smooth' });
    }
  }, []);

  const scrollRight = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 750, behavior: 'smooth' });
    }
  }, []);

  const showAll = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' });
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
      <div className="flex flex-row gap-4 justify-between items-end pb-4 mr-8">
        <div className="flex flex-row items-center">
          {(showUser || imageUrl) && 
            <Image
              src={showUser && profilePicture ? profilePicture : imageUrl ?? ""}
              alt="Profile"
              className="w-12 h-12 rounded-full mr-4"
              height={200}
              width={200}
            /> 
          }
          <div className="flex flex-col">
            <span className="text-sm md:text-base lg:text-lg text-gray-400">
              {(showUser && username ? username : topText)?.toUpperCase()}
            </span>
            <h1 className="font-bold text-base md:text-2xl lg:text-3xl">
              {heading}
            </h1>
          </div>
        </div>
        <div className="flex flex-row gap-4 items-center">
          {id && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="border border-[#4a4a4a] rounded-full w-8 h-8 flex items-center justify-center">
                  <Ellipsis className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="text-white bg-gray-800 bg-opacity-30 backdrop-filter backdrop-blur-lg border border-gray-700 shadow-lg rounded-lg p-4">
                <div className="flex flex-col gap-2">
                  <button
                    className={`flex items-center gap-2 ${currentComponent?.pinned ? 'text-purple-400' : ''}`}
                    onClick={handlePinToggle}
                  >
                    <Pin className="w-4 h-4" />
                    {currentComponent?.pinned ? 'Unpin from Home' : 'Pin to Home'}
                  </button>
                  <button
                    className={`flex items-center gap-2 ${currentComponent?.visible ? '' : 'bg-purple-400'}`}
                    onClick={handleVisibilityToggle}
                  >
                    {currentComponent?.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    {currentComponent?.visible ? 'Hide this section' : 'Show this section'}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <button
            className={`border border-[#4a4a4a] rounded-full w-8 h-8 flex items-center justify-center ${isAtStart ? 'brightness-50 pointer-events-none' : ''}`}
            onClick={scrollLeft}
            disabled={isAtStart}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            className={`border border-[#4a4a4a] rounded-full w-8 h-8 flex items-center justify-center ${isAtEnd ? 'brightness-50 pointer-events-none' : ''}`}
            onClick={scrollRight}
            disabled={isAtEnd}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
  
      <ScrollArea className="w-full pb-20" viewportRef={scrollRef}>
        <div className="min-h-full h-auto">{children}</div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </>
  );
}