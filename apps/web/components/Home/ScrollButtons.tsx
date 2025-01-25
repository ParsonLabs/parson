"use client";

import getSession from '@/lib/Authentication/JWT/getSession';
import { getProfilePicture } from '@music/sdk';
import { ScrollArea, ScrollBar } from '@music/ui/components/scroll-area';
import { ChevronLeft, ChevronRight, Ellipsis, Pin, Eye, EyeOff } from 'lucide-react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@music/ui/components/popover';
import { useLayoutConfig } from '../Providers/LayoutConfigContext';
import { useSession } from '../Providers/AuthProvider';
import { useQuery } from "@tanstack/react-query";

type ScrollButtonsProps = {
  id?: string;
  children: React.ReactNode;
  heading: string;
  showUser?: boolean;
  topText?: string;
  imageUrl?: string;
};

const MemoizedHeaderImage = memo(({ src, alt }: { src: string; alt: string }) => (
  <Image
    src={src}
    alt={alt}
    className="w-12 h-12 rounded-full mr-4"
    height={200}
    width={200}
  />
));
MemoizedHeaderImage.displayName = 'MemoizedHeaderImage';

const MemoizedHeaderText = memo(({ topText, heading }: { topText?: string; heading: string }) => (
  <div className="flex flex-col">
    <span className="text-sm md:text-base lg:text-lg text-gray-400">
      {topText?.toUpperCase()}
    </span>
    <h1 className="font-bold text-base md:text-2xl lg:text-3xl">
      {heading}
    </h1>
  </div>
));
MemoizedHeaderText.displayName = 'MemoizedHeaderText';

const MemoizedScrollButtons = memo(({ isAtStart, isAtEnd, onScrollLeft, onScrollRight }: {
  isAtStart: boolean;
  isAtEnd: boolean;
  onScrollLeft: () => void;
  onScrollRight: () => void;
}) => (
  <div className="flex gap-4">
    <button
      className={`border border-[#4a4a4a] rounded-full w-8 h-8 flex items-center justify-center ${isAtStart ? 'brightness-50 pointer-events-none' : ''}`}
      onClick={onScrollLeft}
      disabled={isAtStart}
    >
      <ChevronLeft className="w-4 h-4" />
    </button>
    <button
      className={`border border-[#4a4a4a] rounded-full w-8 h-8 flex items-center justify-center ${isAtEnd ? 'brightness-50 pointer-events-none' : ''}`}
      onClick={onScrollRight}
      disabled={isAtEnd}
    >
      <ChevronRight className="w-4 h-4" />
    </button>
  </div>
));
MemoizedScrollButtons.displayName = 'MemoizedScrollButtons';

const MemoizedPopover = memo(({ id, currentComponent, onPinToggle, onVisibilityToggle }: {
  id: string;
  currentComponent?: { pinned: boolean; visible: boolean };
  onPinToggle: () => void;
  onVisibilityToggle: () => void;
}) => (
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
          onClick={onPinToggle}
        >
          <Pin className="w-4 h-4" />
          {currentComponent?.pinned ? 'Unpin from Home' : 'Pin to Home'}
        </button>
        <button
          className={`flex items-center gap-2 ${currentComponent?.visible ? '' : 'bg-purple-400'}`}
          onClick={onVisibilityToggle}
        >
          {currentComponent?.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          {currentComponent?.visible ? 'Hide this section' : 'Show this section'}
        </button>
      </div>
    </PopoverContent>
  </Popover>
));
MemoizedPopover.displayName = 'MemoizedPopover';

const ScrollButtons: React.FC<ScrollButtonsProps> = ({ 
  showUser = true,
  id, 
  children, 
  heading, 
  topText, 
  imageUrl 
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const [canScroll, setCanScroll] = useState(false);
  const { components, setComponents } = useLayoutConfig();
  const { session } = useSession();

  const { data: profileData } = useQuery({
    queryKey: ['profilePicture', session?.sub],
    queryFn: async () => {
      if (!session?.sub || !showUser) return null;
      const profilePictureBlob = await getProfilePicture(Number(session.sub));
      const profilePictureUrl = URL.createObjectURL(profilePictureBlob);
      return {
        pictureUrl: profilePictureUrl,
        username: String(session.username)
      };
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!session?.sub && showUser,
  });

  useEffect(() => {
    if (profileData?.pictureUrl) {
      return () => URL.revokeObjectURL(profileData.pictureUrl);
    }
  }, [profileData?.pictureUrl]);

  const checkScrollPosition = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setIsAtStart(scrollLeft === 0);
      setIsAtEnd(scrollLeft + clientWidth >= scrollWidth);
      setCanScroll(scrollWidth > clientWidth);
    }
  }, []);

  useEffect(() => {
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
  }, [checkScrollPosition]);

  const handleScroll = useCallback((direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -750 : 750;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
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
          {(showUser || imageUrl) && (
            <MemoizedHeaderImage 
              src={showUser && profileData?.pictureUrl ? profileData.pictureUrl : imageUrl ?? ""} 
              alt="Profile"
            />
          )}
          <MemoizedHeaderText topText={showUser ? profileData?.username : topText} heading={heading} />
        </div>
        <div className="flex flex-row gap-4 items-center">
          {id && (
            <MemoizedPopover
              id={id}
              currentComponent={currentComponent}
              onPinToggle={handlePinToggle}
              onVisibilityToggle={handleVisibilityToggle}
            />
          )}
          <MemoizedScrollButtons
            isAtStart={isAtStart}
            isAtEnd={isAtEnd}
            onScrollLeft={() => handleScroll('left')}
            onScrollRight={() => handleScroll('right')}
          />
        </div>
      </div>
      <ScrollArea className="w-full pb-20" viewportRef={scrollRef}>
        <div className="min-h-full h-auto">{children}</div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </>
  );
}

ScrollButtons.displayName = 'ScrollButtons';

export default ScrollButtons;