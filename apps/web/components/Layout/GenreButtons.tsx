"use client"

import { listAllGenres } from "@music/sdk"
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area"
import { useState, useEffect, ReactNode } from "react"
import ListenAgain from "../Home/ListenAgain"
import RecommendedAlbums from "../Home/RecommendedAlbums"
import RandomSongs from "../Home/RandomSongs"
import FromYourLibrary from "../Home/FromYourLibrary"
import MusicVideos from "../Home/MusicVideos"

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase())
}

interface GenreButtonsProps {
  children: ReactNode
}

export default function GenreButtons({ children }: GenreButtonsProps) {
  const [genres, setGenres] = useState<string[]>([])
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)

  useEffect(() => {
    async function fetchGenres() {
      let genreList = await listAllGenres()
      setGenres(genreList.slice(0, 10))
    }

    fetchGenres()
  }, [])

  const handleGenreClick = (genre: string) => {
    setSelectedGenre(prevGenre => (prevGenre === genre ? null : genre))
  }

  return (
    <>
      <ScrollArea className="w-5/6 whitespace-nowrap rounded-md pb-10">
        <div className="flex w-max space-x-4 p-4">
          {genres.map((genre, index) => (
            <button
              key={index}
              className={`shrink-0 m-2 p-3 rounded-xl backdrop-blur-3xl text-sm bg-gradient-to-r shadow-lg ring-1 ring-black/5 ${
                selectedGenre === genre ? 'bg-white text-black' : 'bg-opacity-30'
              }`}
              onClick={() => handleGenreClick(genre)}
            >
              {capitalizeWords(genre)}
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {selectedGenre && (
        <>
          <ListenAgain genre={selectedGenre} />
          <RecommendedAlbums genre={selectedGenre} />
          <RandomSongs genre={selectedGenre} />
          <FromYourLibrary genre={selectedGenre} />
          <MusicVideos />
        </>
      )}
      {!selectedGenre && children}
    </>
  );
}