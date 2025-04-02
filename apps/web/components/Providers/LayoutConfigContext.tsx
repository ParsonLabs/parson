"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

type ComponentConfig = {
  id: string;
  name: string;
  visible: boolean;
  pinned: boolean;
};

type LayoutConfigContextType = {
  components: ComponentConfig[];
  setComponents: React.Dispatch<React.SetStateAction<ComponentConfig[]>>;
};

const LayoutConfigContext = createContext<LayoutConfigContextType | undefined>(undefined);

export const LayoutConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [components, setComponents] = useState<ComponentConfig[]>([]);

  useEffect(() => {
    const savedConfig = localStorage.getItem("layoutConfig");
    if (savedConfig) {
      setComponents(JSON.parse(savedConfig));
    } else {
      setComponents([
        { id: "LandingCarousel", name: "Landing Carousel", visible: true, pinned: false },
        { id: "ListenAgain", name: "Listen Again", visible: true, pinned: false },
        { id: "SpeedDial", name: "Speed Dial", visible: true, pinned: false },
        { id: "SimilarTo", name: "Similar To", visible: true, pinned: false },
        { id: "RecommendedAlbums", name: "Recommended Albums", visible: true, pinned: false },
        { id: "RandomSongs", name: "Random Songs", visible: true, pinned: false },
        { id: "FromYourLibrary", name: "From Your Library", visible: true, pinned: false },
        { id: "MusicVideos", name: "Music Videos", visible: true, pinned: false },
        { id: "PopularGenres", name: "Popular Genres", visible: true, pinned: false },
        { id: "RecentlyAddedAlbums", name: "Recently Added Albums", visible: true, pinned: false },
        { id: "Top Artists", name: "Top Artists", visible: true, pinned: false },
      ]);
    }
  }, []);

  useEffect(() => {
    if (components.length > 0) {
      localStorage.setItem("layoutConfig", JSON.stringify(components));
    }
  }, [components]);

  return (
    <LayoutConfigContext.Provider value={{ components, setComponents }}>
      {children}
    </LayoutConfigContext.Provider>
  );
};

export const useLayoutConfig = () => {
  const context = useContext(LayoutConfigContext);
  if (!context) {
    throw new Error('useLayoutConfig must be used within a LayoutConfigProvider');
  }
  return context;
};