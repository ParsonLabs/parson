"use client";

import getSession from "@/lib/Authentication/JWT/getSession";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getSimilarTo, AlbumCardProps } from "@music/sdk";
import { useEffect, useState } from "react";
import PageGradient from "../Layout/PageGradient";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import ScrollButtons from "./ScrollButtons";
import { Skeleton } from "@music/ui/components/skeleton";

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

export default function SimilarTo() {
  const [similarAlbums, setSimilarAlbums] = useState<AlbumCardProps[]>([]);
  const [genre, setGenre] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchSimilarAlbums = async () => {
      try {
        const session = getSession();
        if (!session || !session.sub) {
          throw new Error("Invalid session");
        }
        const similarTo = await getSimilarTo(Number(session.sub));
        console.log("Fetched similar albums:", similarTo[0]);
        console.log("Fetched genre:", similarTo[1]);
        setGenre(similarTo[1]);
        setSimilarAlbums(similarTo[0]);
      } catch (err: any) {
        console.error(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSimilarAlbums();
  }, []);

  const albumCoverSrc = similarAlbums[0]?.album_cover?.length === 0
    ? "/snf.png"
    : `${getBaseURL()}/image/${encodeURIComponent(similarAlbums[0]?.album_cover || "")}`;

  return similarAlbums.length !== 0 && (
    <>
      <PageGradient imageSrc={albumCoverSrc} />
      <ScrollButtons heading={capitalizeWords(genre ?? "")} topText="SIMILAR TO" imageUrl={albumCoverSrc} id="SimilarTo">
        <div className="w-full h-full">
          <div className="grid grid-flow-col grid-rows-2 gap-2 w-full h-full">
            {similarAlbums.map((album, index) => (
              <div className="w-48 h-full pb-28 scale-90" key={index}>
                <AlbumCard
                  artist_id={album.artist_id}
                  artist_name={album.artist_name}
                  album_id={album.album_id}
                  album_name={album.album_name}
                  album_cover={album.album_cover}
                  album_songs_count={album.album_songs_count}
                  first_release_date={album.first_release_date}
                />
              </div>
            ))}
          </div>
        </div>
      </ScrollButtons>
    </>
  );
}