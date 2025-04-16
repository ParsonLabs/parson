"use client";

import FromYourLibrary from "@/components/Home/FromYourLibrary";
import LandingCarousel from "@/components/Home/LandingCarousel";
import ListenAgain from "@/components/Home/ListenAgain";
import MusicVideos from "@/components/Home/MusicVideos";
import RandomSongs from "@/components/Home/RandomSongs";
import RecommendedAlbums from "@/components/Home/RecommendedAlbums";
import SimilarTo from "@/components/Home/SimilarTo";
import CustomiseFeed from "@/components/Layout/CustomiseFeed";
import GenreButtons from "@/components/Layout/GenreButtons";
import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import { hasConfig } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useLayoutConfig } from "@/components/Providers/LayoutConfigContext";
import TopArtists from "@/components/Home/TopArtists";
import RecentlyAddedAlbums from "@/components/Home/RecentlyAddedAlbums";
import PopularGenres from "@/components/Home/PopularGenres";
import { Settings } from "lucide-react";
import MusicVideosHomepage from "@/components/Music/MusicVideosHomepage";

export default function Home() {
  const [configExists, setConfigExists] = useState(true);
  const { components, setComponents } = useLayoutConfig();
  const { setGradient, gradient } = useGradientHover();
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileCustomize, setShowMobileCustomize] = useState(false);

  useEffect(() => {
    async function checkConfig() {
      const config = await hasConfig();
      if (config) {
        setConfigExists(true);
      } else {
        setConfigExists(false);
        setGradient("#FFFFFF");
      }
    }

    checkConfig();
  }, [setGradient]);

  useEffect(() => {
    const savedConfig = localStorage.getItem("layoutConfig");
    if (savedConfig) {
      const parsedConfig = JSON.parse(savedConfig);
      setComponents(parsedConfig);
    } else {
    }
  }, [setComponents]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);

    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (components && components.length > 0) {
      localStorage.setItem("layoutConfig", JSON.stringify(components));
    }
  }, [components]);

  type ComponentConfig = {
    id: string;
    name: string;
    visible: boolean;
    pinned: boolean;
  };

  const renderComponent = (component: ComponentConfig): JSX.Element | null => {
    if (!component.visible) return null;
    
    const componentElement = (() => {
      switch (component.id) {
        case "LandingCarousel":
          return <LandingCarousel />;
        case "ListenAgain":
          return <ListenAgain />;
        case "SimilarTo":
          return <SimilarTo />;
        case "RecommendedAlbums":
          return <RecommendedAlbums />;
        case "RandomSongs":
          return <RandomSongs />;
        case "FromYourLibrary":
          return <FromYourLibrary />;
        case "MusicVideos":
          return <MusicVideosHomepage />;
        case "PopularGenres":
          return <PopularGenres />;
        case "RecentlyAddedAlbums":
          return <RecentlyAddedAlbums />;
        case "TopArtists":
          return <TopArtists />;
        default:
          return null;
      }
    })();
    
    if (!componentElement) return null;
    
    return (
      <div 
        key={component.id}
        className="animate-fadeIn motion-reduce:animate-none"
      >
        {componentElement}
      </div>
    );
  };

  return configExists ? (
    <div 
      className="min-h-screen pb-28 pt-4 bg-gradient-to-b from-background to-background/95"
      style={{
        backgroundImage: `radial-gradient(circle at top right, ${gradient}15, transparent 70%)`,
      }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="space-y-12">
          <section className="mb-8">
            {components
              .filter(component => component.pinned && component.visible)
              .map(renderComponent)}
          </section>
          
          <Suspense>
            <GenreButtons>
              <div className="grid grid-cols-1 gap-y-10">
                {components
                  .filter(component => !component.pinned && component.visible)
                  .map(renderComponent)}
              </div>
            </GenreButtons>
          </Suspense>
        </div>
      </div>
      {isMobile && (
        <>
          <button
            onClick={() => setShowMobileCustomize(true)}
            className="fixed bottom-24 right-4 z-20 bg-white/10 backdrop-blur-lg p-3 rounded-full shadow-lg border border-white/20"
          >
            <Settings className="w-6 h-6" />
          </button>
          
          {showMobileCustomize && (
            <div 
              className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowMobileCustomize(false)}
            >
              <div 
                className="absolute bottom-0 left-0 right-0 bg-zinc-900 rounded-t-xl p-6"
                onClick={e => e.stopPropagation()}
              >
                <div className="w-12 h-1 bg-white/20 mx-auto mb-6 rounded-full"></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  ) : (
    <div className="min-h-screen flex flex-col justify-center items-center space-y-4">
      <p className="text-5xl">No Config Found!</p>
      <p className="font-semibold">
        <Link href="/setup/library" className="underline">
          Head to the setup page to index your library
        </Link>
      </p>
      <Link href="/setup/library">
        <Button className="bg-white text-black hover:bg-gray-500">
          Head to Setup Page
        </Button>
      </Link>
    </div>
  );
}