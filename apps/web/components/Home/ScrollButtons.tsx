"use client"

import { ScrollArea, ScrollBar } from '@music/ui/components/scroll-area';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

type ScrollButtonsProps = {
  children: React.ReactNode;
  heading: string;
};

export default function ScrollButtons({ children, heading }: ScrollButtonsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const [canScroll, setCanScroll] = useState(false);

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

  return (
    <>
      <div className="flex flex-row gap-4 justify-between items-center pb-4 mr-8">
        <h1 className="font-bold text-base md:text-2xl lg:text-3xl mr-5">{heading}</h1>
        <div className='flex flex-row gap-4 items-center'>
          {false ? (
            <button
              className="border border-[#4a4a4a] rounded-full px-3 py-1 text-base"
              onClick={showAll}>
              More
            </button>
          ) : (
            <div className="w-[75px] h-[32px]"></div>
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
  
      <ScrollArea className="w-full overflow-x-auto overflow-y-auto h-96 pb-20" viewportRef={scrollRef}>
        {children}
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </>
  );
}