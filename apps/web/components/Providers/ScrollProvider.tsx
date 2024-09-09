"use client"

import React, { createContext, useState, useEffect, useRef } from 'react';

export const ScrollContext = createContext({
  onTopOfPage: true,
});

type ScrollProviderProps = {
  children: React.ReactNode
}

export const ScrollProvider = ({ children }: ScrollProviderProps) => {
  const [onTopOfPage, setOnTopOfPage] = useState(true);
  const scrollContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollContainer.current) {
        setOnTopOfPage(scrollContainer.current.scrollTop === 0);
      }
    };

    const container = scrollContainer.current;

    if (container) {
      container.addEventListener('scroll', handleScroll);

      return () => {
        container.removeEventListener('scroll', handleScroll);
      };
    }
  }, []);


  return (
    <ScrollContext.Provider value={{ onTopOfPage }}>
      <div ref={scrollContainer} className="overflow-auto h-screen">
        {children}
      </div>
    </ScrollContext.Provider>
  );
};