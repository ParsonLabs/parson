"use client";

import Description from "@/components/Description/Description";
import PageGradient from "@/components/Layout/PageGradient";
import AlbumTable from "@/components/Music/Album/AlbumTable";
import getBaseURL from "@/lib/Server/getBaseURL";
import MusicbrainzLogo from "@/public/musicbrainz_icon.png";
import DiscogsLogo from "@/public/discogs_icon.png";
import WikidataLogo from "@/public/wikidata_logo.png";
import WikipediaLogo from "@/public/wikipedia_logo.png";
import AllmusicLogo from "@/public/AllmusicLogo.png";
import RateyourmusicLogo from "@/public/RateyourmusicLogo.png";
import PitchforkLogo from "@/public/PitchforkLogo.png";
import BBCLogo from "@/public/BBCLogo.svg";
import { getAlbumInfo, LibraryAlbum } from "@music/sdk";
import { Artist } from "@music/sdk/types";
import { Badge } from "@music/ui/components/badge";
import { Button } from "@music/ui/components/button";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import Image from "next/image";
import Link from "next/link";
import { redirect, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function AlbumComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  const [album, setAlbum] = useState<LibraryAlbum | null>(null);
  const [artist, setArtist] = useState<Artist | null>(null);

  useEffect(() => {
    if (!id || typeof id !== "string") return;

    const fetchAlbum = async () => {
      const album = await getAlbumInfo(id);
      const artistData = album.artist_object;

      if (!artistData || !album) {
        redirect("/404");
      } else {
        setAlbum(album);
        setArtist(artistData);
      }
    };

    fetchAlbum();
  }, [id]);

  if (!album || !artist) {
    return null;
  }

  const albumCoverURL =
    album.cover_url.length === 0
      ? "/snf.png"
      : `${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}?raw=true`;

  function formatDuration(duration: number) {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.round(duration % 60);

    let result = "";
    if (hours > 0) {
      result += `${hours} Hour${hours > 1 ? "s" : ""} `;
    }
    if (minutes > 0) {
      result += `${minutes} Minute${minutes > 1 ? "s" : ""} `;
    }
    return result.trim();
  }

  let totalDuration = album.songs.reduce(
    (total, song) => total + song.duration,
    0
  );
  let releaseDate = new Date(album.first_release_date).toLocaleString(
    "default",
    { month: "long", year: "numeric" }
  );

  return (
    <div className="flex h-full">
      <Image
        className="bg-cover bg-center blur-3xl w-full h-full"
        src={albumCoverURL}
        height={800}
        width={800}
        alt={`${album.name} Cover URL`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          filter: "blur(24px) brightness(50%)",
          objectFit: "cover",
          objectPosition: "center",
        }}
      />
      <div className="flex-1 h-full overflow-x-hidden overflow-y-auto relative">
        <ScrollArea className="h-full w-full">
          <PageGradient imageSrc={albumCoverURL} />
          <div className="flex flex-col md:flex-row items-start md:items-center my-8">
            <div className="flex items-center justify-center w-full md:w-auto md:justify-start">
              <div className="flex flex-col md:flex-row">
                <div className="flex-shrink-0 w-72 h-72">
                  <Image
                    src={albumCoverURL}
                    alt={`${album.name} Image`}
                    height={400}
                    width={400}
                    className="w-full h-full object-fill rounded"
                  />
                </div>
                <div className="md:pl-4 flex-grow">
                  <h1 className="text-4xl mt-8">{album.name}</h1>
                  <Link href={`/artist?id=${artist.id}`}>
                    <p className="text-3xl">
                      {album.release_group_album?.artist_credit.map(
                        (artist) => (
                          <span key={artist.musicbrainz_id}>{artist.name}</span>
                        )
                      )}
                      {album.release_album?.information.artist_credits.map(
                        (artist) => (
                          <span key={artist.musicbrainz_id}>{artist.name}</span>
                        )
                      )}
                    </p>
                  </Link>
                  <p>
                    {album.release_group_album?.rating.value !== 0 &&
                      renderStars(album.release_group_album?.rating.value || 0)}
                  </p>
                  <p>{releaseDate}</p>
                  <div className="flex flex-row gap-2">
                    <p>{album.songs.length} Songs</p>
                    <p>•</p>
                    <p>{formatDuration(totalDuration)}</p>
                  </div>
                    <p>
                      {album.release_group_album?.genres.map((tag) => (
                        <Badge
                          key={tag.count}
                          variant="outline"
                          className="mb-2 mr-1"
                        >
                          {tag.name}
                        </Badge>
                      ))}
                      {album.release_album?.genres.map((tag) => (
                        <Badge
                          key={tag.count}
                          variant="outline"
                          className="mb-2 mr-1"
                        >
                          {tag.name}
                        </Badge>
                      ))}
                    </p>
                  <Link
                    href={
                      album.release_group_album
                        ? `https://musicbrainz.org/release-group/${album.musicbrainz_id}`
                        : `https://musicbrainz.org/release/${album.musicbrainz_id}`
                    }
                    target="_blank"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-inherit"
                    >
                      <Image
                        src={MusicbrainzLogo}
                        alt="MusicBrainz Logo"
                        height={200}
                        width={200}
                      />
                    </Button>
                  </Link>
                  {album.release_group_album?.relationships.map(
                    (relationship) => (
                      <Link
                        key={relationship.musicbrainz_id}
                        href={relationship.url}
                        target="_blank"
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-inherit m-1"
                        >
                          <Image
                            src={
                              relationship.url.includes("discogs")
                                ? DiscogsLogo
                                : relationship.url.includes("wikidata")
                                  ? WikidataLogo
                                  : relationship.url.includes("wikipedia")
                                    ? WikipediaLogo
                                    : relationship.url.includes("allmusic")
                                      ? AllmusicLogo
                                      : relationship.url.includes(
                                            "rateyourmusic"
                                          )
                                        ? RateyourmusicLogo
                                        : relationship.url.includes("pitchfork")
                                          ? PitchforkLogo
                                          : relationship.url.includes("bbc")
                                            ? BBCLogo
                                            : MusicbrainzLogo
                            }
                            alt={
                              relationship.url.includes("discogs")
                                ? "Discogs Logo"
                                : relationship.url.includes("wikidata")
                                  ? "Wikidata Logo"
                                  : relationship.url.includes("wikipedia")
                                    ? "Wikipedia Logo"
                                    : relationship.url.includes("allmusic")
                                      ? "AllMusic Logo"
                                      : relationship.url.includes("musicmoz")
                                        ? "MusicMoz Logo"
                                        : relationship.url.includes(
                                              "rateyourmusic"
                                            )
                                          ? "RateYourMusic Logo"
                                          : relationship.url.includes(
                                                "pitchfork"
                                              )
                                            ? "Pitchfork Logo"
                                            : relationship.url.includes("bbc")
                                              ? "BBC Logo"
                                              : "MusicBrainz Logo"
                            }
                            className="w-8 h-8"
                          />
                        </Button>
                      </Link>
                    )
                  )}
                  {album.release_album?.relationships.map((relationship) => (
                    <Link
                      key={relationship.musicbrainz_id}
                      href={relationship.url}
                      target="_blank"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-inherit m-1"
                      >
                        <Image
                          src={
                            relationship.url.includes("discogs")
                              ? DiscogsLogo
                              : relationship.url.includes("wikidata")
                                ? WikidataLogo
                                : relationship.url.includes("wikipedia")
                                  ? WikipediaLogo
                                  : relationship.url.includes("allmusic")
                                    ? AllmusicLogo
                                    : relationship.url.includes("rateyourmusic")
                                      ? RateyourmusicLogo
                                      : relationship.url.includes("pitchfork")
                                        ? PitchforkLogo
                                        : relationship.url.includes("bbc")
                                          ? BBCLogo
                                          : MusicbrainzLogo
                          }
                          alt={
                            relationship.url.includes("discogs")
                              ? "Discogs Logo"
                              : relationship.url.includes("wikidata")
                                ? "Wikidata Logo"
                                : relationship.url.includes("wikipedia")
                                  ? "Wikipedia Logo"
                                  : relationship.url.includes("allmusic")
                                    ? "AllMusic Logo"
                                    : relationship.url.includes("musicmoz")
                                      ? "MusicMoz Logo"
                                      : relationship.url.includes(
                                            "rateyourmusic"
                                          )
                                        ? "RateYourMusic Logo"
                                        : relationship.url.includes("pitchfork")
                                          ? "Pitchfork Logo"
                                          : relationship.url.includes("bbc")
                                            ? "BBC Logo"
                                            : "MusicBrainz Logo"
                          }
                          className="w-8 h-8"
                        />
                      </Button>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <Description description={album.description} />
          <AlbumTable
            album={album}
            songs={album.songs}
            artist={artist}
            key={album.id}
          />
          <ScrollBar />
        </ScrollArea>
      </div>
    </div>
  );
}

const renderStars = (rating: number) => {
  const fullStars = Math.floor(rating);
  const halfStar = rating % 1 >= 0.5 ? 1 : 0;
  const emptyStars = 5 - fullStars - halfStar;

  return (
    <>
      {"★".repeat(fullStars)}
      {halfStar ? "☆" : ""}
      {"☆".repeat(emptyStars)}
    </>
  );
};
