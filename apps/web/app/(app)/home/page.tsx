"use client"

import FromYourLibrary from "@/components/Home/FromYourLibrary";
import LandingCarousel from "@/components/Home/LandingCarousel";
import ListenAgain from "@/components/Home/ListenAgain";
import MusicVideos from "@/components/Home/MusicVideos";
import RandomSongs from "@/components/Home/RandomSongs";
import RecommendedAlbums from "@/components/Home/RecommendedAlbums";
import GenreButtons from "@/components/Layout/GenreButtons";

export default function Home() {
  return (
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
  );
}
