"use client";

import Description from "@/components/Description/Description";
import PageGradient from "@/components/Layout/PageGradient";
import AlbumTable from "@/components/Music/Album/AlbumTable";
import getBaseURL from "@/lib/Server/getBaseURL";
import AllmusicLogo from "@/public/AllmusicLogo.png";
import BBCLogo from "@/public/BBCLogo.svg";
import DiscogsLogo from "@/public/discogs_icon.png";
import MusicbrainzLogo from "@/public/musicbrainz_icon.png";
import PitchforkLogo from "@/public/PitchforkLogo.png";
import RateyourmusicLogo from "@/public/RateyourmusicLogo.png";
import WikidataLogo from "@/public/wikidata_logo.png";
import WikipediaLogo from "@/public/wikipedia_logo.png";
import { getAlbumInfo, getArtistInfo, LibraryAlbum } from "@music/sdk";
import { Artist } from "@music/sdk/types";
import { Badge } from "@music/ui/components/badge";
import { Button } from "@music/ui/components/button";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function AlbumComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  const [album, setAlbum] = useState<LibraryAlbum | null>(null);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [contributingArtists, setContributingArtists] = useState<Artist[]>([]);
  
  useEffect(() => {
    if (!id || typeof id !== "string") return;
  
    const fetchAlbumInfo = async () => {
      const album = await getAlbumInfo(id);
  
      const artistData = album.artist_object;
      const contributingArtistIds = album.contributing_artists_ids;
  
      const contributingArtistsPromises = contributingArtistIds.map((artistId) =>
        getArtistInfo(artistId)
      );
  
      const contributingArtistsData = await Promise.all(contributingArtistsPromises);

      setAlbum(album);
      setArtist(artistData);
      setContributingArtists(contributingArtistsData);
    };
  
    fetchAlbumInfo();
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
      result += `${hours} hr${hours > 1 ? "s" : ""} `;
    }
    if (minutes > 0) {
      result += `${minutes} min${minutes > 1 ? "s" : ""} `;
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
    <div className="flex flex-col md:flex-row h-full">
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
          filter: "blur(80px) brightness(60%)",
          objectFit: "cover",
          objectPosition: "center",
        }}
      />
      <div className="flex-1 h-full overflow-hidden relative">
        <PageGradient imageSrc={albumCoverURL} />
        <div className="flex flex-col md:flex-row items-start my-8">
          <ScrollArea className="flex flex-col items-center w-full md:w-1/4 h-full">
            <div className="flex-shrink-0 w-72 h-72 mx-auto">
              <Image
                src={albumCoverURL}
                alt={`${album.name} Image`}
                height={400}
                width={400}
                className="w-full h-full object-fill rounded"
              />
            </div>
            <div className="md:pl-4 flex-grow text-center mt-4">
              <h1 className="text-4xl">{album.name}</h1>
              {album.release_group_album?.rating.value !== 0 && renderStars(album.release_group_album?.rating.value || 0)}
              <div className="flex flex-col gap-2 justify-center items-center mt-4 pb-4">
                <Link href={`/artist?id=${artist.id}`} className="flex items-center">
                  <Image
                    src={artist.icon_url.length === 0 ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}`}
                    width={20}
                    height={20}
                    alt={`${artist.name} Profile Picture`}
                    className="rounded-full"
                  />
                  <p className="text-xs text-gray-200 ml-2">
                    {album.release_group_album?.artist_credit.map((artist) => (
                      <span key={artist.musicbrainz_id}>{artist.name}</span>
                    ))}
                    {album.release_album?.information.artist_credits.map((artist) => (
                      <span key={artist.musicbrainz_id}>{artist.name}</span>
                    ))}
                  </p>
                </Link>
                <div className="flex flex-row gap-2 justify-center items-center">
                  <p className="text-xs text-gray-400">{releaseDate}</p>
                  <p className="text-xs text-gray-400">•</p>
                  <p className="text-xs text-gray-400">{album.songs.length} Songs</p>
                  <p className="text-xs text-gray-400">•</p>
                  <p className="text-xs text-gray-400">{formatDuration(totalDuration)}</p>
                </div>
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
              {album.release_group_album?.relationships.map((relationship) => (
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
                            : relationship.url.includes("rateyourmusic")
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
                            : relationship.url.includes("rateyourmusic")
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
            <Description description={album.description}/>
            <div className="grid grid-cols-1 gap-4 mt-4">
              {contributingArtists.map(artist => (
                <Link href={`/artist/${artist.id}`} key={artist.id}>
                  <div key={artist.id} className="flex items-center">
                    <Image
                      src={artist.icon_url.length === 0 ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}`}
                      alt={`${artist.name} Image`}
                      height={70}
                      width={70}
                      className="rounded-full"
                      />
                    <p className="ml-4 text-gray-500 text-xl">{artist.name}</p>
                  </div>
                </Link>
              ))}
            </div>
          </ScrollArea>
          <ScrollArea className="flex-grow md:ml-8 h-full pt-10">
            <div className="p-8 w-full">
              <AlbumTable
                album={album}
                songs={album.songs}
                artist={artist}
                key={album.id}
              />
            </div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </div>
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
