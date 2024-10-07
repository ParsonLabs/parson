"use client";

import getSession from "@/lib/Authentication/JWT/getSession";
import { addSearchHistory, deleteItemFromSearchHistory, getLastSearchedQueries } from "@music/sdk";
import { SearchItem } from "@music/sdk/types";
import { Input } from "@music/ui/components/input";
import { HistoryIcon, Search, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useContext, useEffect, useState } from "react";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { ScrollContext } from "../Providers/ScrollProvider";
import { useSession } from "../Providers/AuthProvider";

type SearchBarProps = {
  isSearchActive: boolean;
  setIsSearchActive: Function;
};

export default function SearchBar({
  isSearchActive,
  setIsSearchActive,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [searchHistory, setSearchHistory] = useState<SearchItem[]>([]);
  const [isSearchBoxClicked, setIsSearchBoxClicked] = useState(false);
  const { onTopOfPage } = useContext(ScrollContext);
  const { areLyricsVisible } = useContext(LyricsContext)
  const { session } = useSession()

  const router = useRouter();
  
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    session && addSearchHistory({ user_id: Number(session.sub), search: query })
    router.push(`/search?q=${query}`);
    setIsSearchActive(false);
  };
  
  useEffect(() => {
    async function getLastSearchedQueriesFn() {
        if (session) {
            const queries = await getLastSearchedQueries({ user_id: Number(session.sub) });
            const uniqueQueries = Array.from(
                new Set(queries.map((item) => JSON.stringify(item)))
            ).map((item) => JSON.parse(item));
            setSearchHistory(uniqueQueries);
        }
    }

      getLastSearchedQueriesFn();
  }, [session]);

  return (
    <div className="flex flex-col relative">
      <div className="sticky top-0 z-10">
        <form
          onSubmit={handleSubmit}
          className={`${isSearchActive ? "w-full flex" : "hidden"} md:flex md:w-96`}
        >
          <Input
            className={`flex-1 text-black border border-[#6e777d] ${onTopOfPage || areLyricsVisible ? "opacity-35 bg-gradient-to-r from-[#2f353a80] to-[#34373580]" : "bg-white"}`}
            placeholder="Search songs, albums, artists"
            value={query}
            onClick={() => setIsSearchBoxClicked(true)}
            onBlur={() => setIsSearchBoxClicked(false)}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <Search
          className="md:hidden cursor-pointer"
          onClick={() => setIsSearchActive(!isSearchActive)}
        />
        {isSearchBoxClicked && searchHistory.length !== 0 && (
          <div
            className="absolute top-full left-0 right-0 bg-black p-5 overflow-auto z-20"
            onMouseDown={(e) => e.preventDefault()}
          >
            {searchHistory.map((item) => (
              <div
                key={item.id}
                className="flex flex-row items-center justify-between py-2"
              >
                <Link href={`/search?q=${item.search}`}>
                  <div className="flex flex-row items-center">
                    <HistoryIcon className="mr-2" />
                    <p className="ml-5 border-b border-gray-700 last:border-b-0">
                      {item.search}
                    </p>
                  </div>
                </Link>
                <button
                  className="z-50"
                  onClick={() => {
                      deleteItemFromSearchHistory({ id: item.id })
                      setSearchHistory(
                        searchHistory.filter(
                          (newItem) => newItem.id !== item.id
                        )
                      );
                  }}
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
