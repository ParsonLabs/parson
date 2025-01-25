"use client"

import { memo, ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { listAllGenres } from "@music/sdk"
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area"
import { useSearchParams, useRouter } from "next/navigation"
import ListenAgain from "../Home/ListenAgain"
import RecommendedAlbums from "../Home/RecommendedAlbums"
import RandomSongs from "../Home/RandomSongs"
import FromYourLibrary from "../Home/FromYourLibrary"
import MusicVideos from "../Home/MusicVideos"

const MemoizedButton = memo(({ genre, isSelected, onClick }: { 
  genre: string; 
  isSelected: boolean; 
  onClick: () => void 
}) => (
  <button
    className={`shrink-0 m-2 p-3 rounded-xl backdrop-blur-3xl text-sm bg-gradient-to-r shadow-lg ring-1 ring-black/5 ${
      isSelected ? 'bg-white text-black' : 'bg-opacity-30'
    }`}
    onClick={onClick}
  >
    {capitalizeWords(genre)}
  </button>
));

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase())
}

interface GenreButtonsProps {
  children: ReactNode
}

export default function GenreButtons({ children }: GenreButtonsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedGenre = searchParams.get('genre')

  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: async () => {
      const genreList = await listAllGenres()
      return genreList.slice(0, 10)
    },
    staleTime: 24 * 60 * 60 * 1000,
  })

  const handleGenreClick = (genre: string) => {
    if (selectedGenre === genre) {
      router.push('/')
    } else {
      router.push(`/?genre=${encodeURIComponent(genre)}`)
    }
  }

  return (
    <>
      <ScrollArea className="w-5/6 whitespace-nowrap rounded-md pb-10">
        <div className="flex w-max space-x-4 p-4">
          {genres.map((genre) => (
            <MemoizedButton
              key={genre}
              genre={genre}
              isSelected={selectedGenre === genre}
              onClick={() => handleGenreClick(genre)}
            />
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
  )
}