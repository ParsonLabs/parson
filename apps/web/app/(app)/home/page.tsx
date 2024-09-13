"use client";

import FromYourLibrary from "@/components/Home/FromYourLibrary";
import LandingCarousel from "@/components/Home/LandingCarousel";
import ListenAgain from "@/components/Home/ListenAgain";
import MusicVideos from "@/components/Home/MusicVideos";
import RandomSongs from "@/components/Home/RandomSongs";
import RecommendedAlbums from "@/components/Home/RecommendedAlbums";
import GenreButtons from "@/components/Layout/GenreButtons";
import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import { getConfig } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Home() {
  let [configExists, setConfigExists] = useState(true);

  const { setGradient } = useGradientHover()

  
  useEffect(() => {
    async function checkConfig() {
      const config = await getConfig();
      if (config && !config.error) {
        setConfigExists(true);
      } else {
        setConfigExists(false);
        setGradient("#FFFFFF")
      }
    }

    checkConfig();
  }, [setGradient]);

  return configExists ? (
    <div className="min-h-screen pt-14 pb-20">
      <GenreButtons>
        <div className="pb-5">
          <LandingCarousel />
        </div>
        <ListenAgain />
        <RecommendedAlbums />
        <RandomSongs />
        <FromYourLibrary />
        <MusicVideos />
      </GenreButtons>
    </div>
  ) : (
    <>
      <div className="min-h-screen flex flex-col justify-center items-center space-y-4">
        <p className="text-5xl">No Config Found!</p>
        <p className="font-semibold">
          <Link href="/setup/library" className="underline">Head to the setup page to index your library</Link>
        </p>
        <Link href="/setup/library">
          <Button className="bg-white text-black hover:bg-gray-500">Head to Setup Page</Button>
        </Link>
      </div>
    </>
  );
}