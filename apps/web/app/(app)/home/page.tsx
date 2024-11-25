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
import { useEffect, useState } from "react";
import { useLayoutConfig } from "@/components/Providers/LayoutConfigContext";

export default function Home() {
  const [configExists, setConfigExists] = useState(true);
  const { components, setComponents } = useLayoutConfig();
  const { setGradient } = useGradientHover();
  const [isMobile, setIsMobile] = useState(false);

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
    switch (component.id) {
      case "LandingCarousel":
        return <LandingCarousel key={component.id} />;
      case "ListenAgain":
        return <ListenAgain key={component.id} />;
      case "SimilarTo":
        return <SimilarTo key={component.id} />;
      case "RecommendedAlbums":
        return <RecommendedAlbums key={component.id} />;
      case "RandomSongs":
        return <RandomSongs key={component.id} />;
      case "FromYourLibrary":
        return <FromYourLibrary key={component.id} />;
      case "MusicVideos":
        return <MusicVideos key={component.id} />;
      default:
        return null;
    }
  };

  return configExists ? (
    <div className="min-h-screen pt-4 pb-20">
      <div className={`relative ${isMobile ? 'pt-4' : 'pr-32 pt-8'} z-10 top top-14 flex flex-col items-end`}>
        {!isMobile && <CustomiseFeed />}
      </div>
      <GenreButtons>
        {components
          .filter((component) => component.pinned)
          .map(renderComponent)}
        {components
          .filter((component) => !component.pinned)
          .map(renderComponent)}
      </GenreButtons>
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