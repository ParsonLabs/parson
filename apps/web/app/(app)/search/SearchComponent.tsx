"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import HorizontalCard from "@/components/Music/Card/HorizontalCard";
import { useSearchParams } from "next/navigation";
import { searchLibrary, searchYouTube } from "@music/sdk";
import TopResultsCard from "@/components/Music/Card/Search/TopResultsCard";

import { DialogFooter, Dialog } from "@music/ui/components/dialog";
import { DialogTrigger, DialogContent } from "@radix-ui/react-dialog";
import ReactPlayer from "react-player";
import Image from "next/image";
import { YoutubeIcon } from "lucide-react";

interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channel: {
    name: string;
  };
  url: string;
}

function YoutubeResultCard({ video }: { video: YouTubeVideo }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <div
          className="flex items-center p-4 hover:bg-gray-800 rounded-lg cursor-pointer"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <Image
            src={video.thumbnail}
            alt={video.title}
            width={1920}
            height={1080}
            className={`w-24 h-16 object-cover rounded transition-filter duration-300 ${
              isHovered ? "brightness-50" : ""
            }`}
            onError={(e) => {
              e.currentTarget.src = "/fallback-thumbnail.png";
            }}
          />
          <div className="ml-4 overflow-hidden">
            <p className="text-sm text-white truncate">{video.title}</p>
            <p className="text-xs text-gray-400 truncate">
              {video.channel.name}
            </p>
          </div>
        </div>
      </DialogTrigger>

      <DialogContent className="fixed inset-0 z-50 max-w-[1000px] h-[80vh] mx-auto bg-gray-900 text-white rounded-3xl overflow-hidden">
        <div className="flex items-center space-x-2 h-full rounded-sm overflow-hidden">
          <ReactPlayer
            controls
            width="100%"
            height="70vh"
            pip={true}
            playing={isDialogOpen}
            url={video.url}
          />
        </div>
        <DialogFooter className="sm:justify-start"></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SearchComponent() {
  const searchParams = useSearchParams();
  const query = searchParams?.get("q") ?? "";

  const [results, setResults] = useState<any[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [youtubeResults, setYoutubeResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function getSearchResults() {
      setLoading(true);
      setError(null);

      try {
        const [searchResults, ytResults] = await Promise.all([
          searchLibrary(query),
          searchYouTube(query),
        ]);

        setResults(searchResults);
        setYoutubeResults(ytResults);
      } catch (err) {
        console.error("Search error:", err);
        setError("Failed to load YouTube results");
      } finally {
        setLoading(false);
      }
    }

    if (query) {
      getSearchResults();
    }
  }, [query]);

  return (
    <>
      <div className="pt-32">
        {!loading && !results && <p className="text-2xl pb-5">Top Result</p>}
        <div className="flex justify-start">
          {loading ? (
            <div className="mb-8">
              <TopResultCardSkeleton />
            </div>
          ) : (
            results && results[0] && <TopResultsCard result={results[0]} />
          )}
        </div>
      </div>

      <div className="overflow-hidden flex justify-between overflow-y-hidden pt-14 pb-20 px-20">
        <div className="w-1/2 transform scale-110 pt-20 pb-20 pr-8">
          {suggestion && suggestion.toLowerCase() !== query.toLowerCase() && (
            <p className="text-sm text-white mt-6">
              Did you mean:{" "}
              <Link
                href={`/search?q=${suggestion}`}
                className="text-gray-200 hover:underline"
              >
                {suggestion}
              </Link>
            </p>
          )}

          {loading ? (
            <>
              <div className="mb-4">
                <HorizontalCardSkeleton />
              </div>
              <div className="mb-8">
                <HorizontalCardSkeleton />
              </div>
              <div className="mb-4">
                <HorizontalCardSkeleton />
              </div>
              <div className="mb-8">
                <HorizontalCardSkeleton />
              </div>
              <div className="mb-4">
                <HorizontalCardSkeleton />
              </div>
              <div className="mb-4">
                <HorizontalCardSkeleton />
              </div>
            </>
          ) : (
            <>
              {results[0]?.item_type === "album" && (
                <>
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "song") && (
                    <>
                      <p className="text-2xl">Songs</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "song")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "album") && (
                    <>
                      <p className="text-2xl">Albums</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "album")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "artist") && (
                    <>
                      <p className="text-2xl">Artists</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter(
                            (result: any) => result.item_type === "artist"
                          )
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {results[0]?.item_type === "artist" && (
                <>
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "album") && (
                    <>
                      <p className="text-2xl">Albums</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "album")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "song") && (
                    <>
                      <p className="text-2xl">Songs</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "song")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "artist") && (
                    <>
                      <p className="text-2xl">Artists</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter(
                            (result: any) => result.item_type === "artist"
                          )
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {results[0]?.item_type === "song" && (
                <>
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "song") && (
                    <>
                      <p className="text-2xl">Songs</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "song")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "album") && (
                    <>
                      <p className="text-2xl">Albums</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "album")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                  {results
                    .slice(1)
                    .some((result: any) => result.item_type === "artist") && (
                    <>
                      <p className="text-2xl">Artists</p>
                      <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                        {results
                          .slice(1)
                          .filter(
                            (result: any) => result.item_type === "artist"
                          )
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                          ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {youtubeResults.length != 0 && (
          <div className="w-1/2 pb-20 pl-8 border-l border-gray-800">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
                From YouTube
              </h2>
              <YoutubeIcon className="w-6 h-6 text-red-600" />
            </div>

            <div className="space-y-4">
              {loading
                ? [...Array(10)].map((_, i) => (
                    <HorizontalCardSkeleton key={i} />
                  ))
                : youtubeResults.map((video) => (
                    <YoutubeResultCard video={video} key={video.id} />
                  ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function HorizontalCardSkeleton() {
  return (
    <div className="w-full text-white flex items-center animate-pulse">
      <div
        className="bg-gray-700 rounded-sm"
        style={{ width: 64, height: 64 }}
      ></div>
      <div className="ml-4">
        <div className="bg-gray-700 h-6 w-32 mb-2 rounded"></div>
        <div className="bg-gray-700 h-4 w-48 rounded"></div>
      </div>
    </div>
  );
}

function TopResultCardSkeleton() {
  return (
    <div
      className="relative flex flex-col items-center p-14 animate-pulse"
      style={{ height: 350, width: 500 }}
    >
      <div
        className="bg-gray-700 blur-3xl"
        style={{
          backgroundColor: "#202020",
          transition: "background background-color 0.5s ease",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          filter: "blur(10px) brightness(50%)",
          zIndex: "10",
        }}
      />
      <div className="relative z-10">
        <div className="bg-gray-700 h-44 w-44 mb-4 rounded"></div>
        <div className="bg-gray-700 h-6 w-32 mb-2 rounded"></div>
        <div className="bg-gray-700 h-4 w-48 rounded"></div>
      </div>
    </div>
  );
}
