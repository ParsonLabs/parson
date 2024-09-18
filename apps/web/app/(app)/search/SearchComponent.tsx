"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import HorizontalCard from "@/components/Music/Card/HorizontalCard";
import { useSearchParams } from 'next/navigation'
import { searchLibrary } from "@music/sdk";
import TopResultsCard from "@/components/Music/Card/Search/TopResultsCard";
import { SearchIcon } from "lucide-react";

export default function SearchComponent() {
  const searchParams = useSearchParams()
  const query = searchParams?.get("q") ?? ""

  const [results, setResults] = useState<any>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function getSearchResults() {
      setLoading(true);
      const searchResults = await searchLibrary(query);
      setResults(searchResults);
      setLoading(false);
    }

    getSearchResults();
  }, [query]);

  return (
    <div className="flex items-center justify-start overflow-y-hidden h-full min-h-screen pt-32 pl-20 pb-20">
    <div className="transform scale-110 pt-20 pb-20">
      {suggestion && suggestion.toLowerCase() !== query.toLowerCase() && (
        <p className="text-sm text-white mt-6">
          Did you mean:{" "}
          <Link href={`/search?q=${suggestion}`} className="text-gray-200 hover:underline">
            {suggestion}
          </Link>
        </p>
      )}

      { !loading && !results && <p className="text-2xl pb-5">Top Result</p> }

      <div className="flex justify-start">
        {loading ? (
          <div className="mb-8">
            <TopResultCardSkeleton />
          </div>
        ) : (
          results && results[0] && <TopResultsCard result={results[0]} />
        )}
      </div>

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
        results && results[0] && (
          <>
            {results[0].item_type === "album" && (
              <>
                {results.slice(1).some((result: any) => result.item_type === "song") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Songs</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "song").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
                {results.slice(1).some((result: any) => result.item_type === "album") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Albums</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "album").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
                {results.slice(1).some((result: any) => result.item_type === "artist") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Artists</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "artist").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {results[0].item_type === "artist" && (
              <>
                {results.slice(1).some((result: any) => result.item_type === "album") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Albums</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "album").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
                {results.slice(1).some((result: any) => result.item_type === "song") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Songs</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "song").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
                {results.slice(1).some((result: any) => result.item_type === "artist") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Artists</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "artist").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {results[0].item_type === "song" && (
              <>
                {results.slice(1).some((result: any) => result.item_type === "song") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Songs</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "song").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
                {results.slice(1).some((result: any) => result.item_type === "album") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Albums</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "album").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
                {results.slice(1).some((result: any) => result.item_type === "artist") && (
                  <>
                    <p className="text-2xl pt-5 pb-1">Artists</p>
                    <div className="grid grid-cols-1 gap-4 pb-10 pt-6 rounded-md pl-2">
                      {results.slice(1).filter((result: any) => result.item_type === "artist").map((result: any) => (
                        <HorizontalCard item={result} key={result.id} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )
      )}
    </div>
    </div>
  );
}

function HorizontalCardSkeleton() {
  return (
    <div className="w-full text-white flex items-center animate-pulse">
      <div className="bg-gray-700 rounded-sm" style={{ width: 64, height: 64 }}></div>
      <div className="ml-4">
        <div className="bg-gray-700 h-6 w-32 mb-2 rounded"></div>
        <div className="bg-gray-700 h-4 w-48 rounded"></div>
      </div>
    </div>
  );
}

function TopResultCardSkeleton() {
  return (
    <div className="relative flex flex-col items-center p-14 animate-pulse" style={{ height: 350, width: 500 }}>
      <div
        className="bg-gray-700 blur-3xl"
        style={{
          backgroundColor: "#202020",
          transition: "background background-color 0.5s ease",
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          filter: 'blur(10px) brightness(50%)',
          zIndex: "10"
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