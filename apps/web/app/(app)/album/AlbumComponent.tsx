"use client";

import Description from "@/components/Description/Description";
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
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const getRelationshipIcon = (url: string) => {
  switch (true) {
    case url.includes("discogs"):
      return { src: DiscogsLogo, alt: "Discogs Logo" };
    case url.includes("wikidata"):
      return { src: WikidataLogo, alt: "Wikidata Logo" };
    case url.includes("wikipedia"):
      return { src: WikipediaLogo, alt: "Wikipedia Logo" };
    case url.includes("allmusic"):
      return { src: AllmusicLogo, alt: "AllMusic Logo" };
    case url.includes("rateyourmusic"):
      return { src: RateyourmusicLogo, alt: "RateYourMusic Logo" };
    case url.includes("pitchfork"):
      return { src: PitchforkLogo, alt: "Pitchfork Logo" };
    case url.includes("bbc"):
      return { src: BBCLogo, alt: "BBC Logo" };
    default:
      return { src: MusicbrainzLogo, alt: "MusicBrainz Logo" };
  }
};

export default function AlbumComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  const [album, setAlbum] = useState<LibraryAlbum | null>(null);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [contributingArtists, setContributingArtists] = useState<Artist[]>([]);

  useEffect(() => {
    if (album?.name && artist?.name) {
      document.title = `${album?.name} by ${artist?.name} | ParsonLabs Music`;
    }
  
      return () => {
        document.title = "ParsonLabs Music";
      }
    }, [album, artist]);

  useEffect(() => {
    if (!id || typeof id !== "string") return;

    const fetchAlbumInfo = async () => {
      const album = (await getAlbumInfo(id, false)) as LibraryAlbum;

      const artistData = album.artist_object;
      const contributingArtistIds = album.contributing_artists_ids;

      if (contributingArtistIds) {
        const contributingArtistsPromises = contributingArtistIds.map(
          (artistId) => getArtistInfo(artistId)
        );

        const contributingArtistsData = await Promise.all(
          contributingArtistsPromises
        );
        setContributingArtists(contributingArtistsData);
      } else {
        setContributingArtists([]);
      }

      setAlbum(album);
      setArtist(artistData);

      // setContributingArtists(contributingArtistsData);
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

  const artistIconURL =
    artist.icon_url.length === 0
      ? "/snf.png"
      : `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}?raw=true`;

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

  let releaseDate = "Release date unknown";
  if (
    album.first_release_date &&
    !isNaN(new Date(album.first_release_date).getTime())
  ) {
    releaseDate = new Date(album.first_release_date).toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  const genres = [
    ...(album.release_group_album?.genres || []),
    ...(album.release_album?.genres || []),
  ];
  const relationships = [
    ...(album.release_group_album?.relationships || []),
    ...(album.release_album?.relationships || []),
  ];

  return (
    <div className="relative min-h-screen">
      <div className="fixed inset-0 bg-neutral-900" />

      <div
        className="fixed inset-0 opacity-30 will-change-transform"
        style={{
          backgroundImage: `url(${albumCoverURL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(140px)",
          transform: "translateZ(0)",
        }}
      />

      <div className="relative z-10 px-4 md:px-8 pt-8 pb-8 backdrop-blur-sm">
        <div className="max-w-8xl mx-auto">
          <div className="flex flex-col items-center md:items-start md:flex-row gap-6 mb-6">
            <div className="flex-shrink-0 flex justify-center md:justify-start">
              <div className="relative w-64 md:w-[300px] aspect-square shadow-2xl">
                <Image
                  src={albumCoverURL}
                  alt={`${album.name} Cover`}
                  layout="fill"
                  className="rounded-lg object-cover"
                  priority
                />
              </div>
            </div>

            <div className="flex flex-col justify-end text-center md:text-left">
              <h1 className="text-4xl md:text-7xl font-bold mb-4 text-white">
                {album.name}
              </h1>
              <div className="flex items-center justify-center md:justify-start gap-2 mb-4">
                <Link href={`/artist?id=${artist.id}`}>
                  <div className="flex items-center hover:opacity-80 transition">
                    <Image
                      src={artistIconURL}
                      width={28}
                      height={28}
                      alt={artist.name}
                      className="rounded-full"
                    />
                    <span className="ml-2 text-lg text-white font-medium">
                      {artist.name}
                    </span>
                  </div>
                </Link>
              </div>

              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-sm text-gray-300">
                <span>{releaseDate}</span>
                <span>•</span>
                <span>{album.songs.length} Songs</span>
                <span>•</span>
                <span>{formatDuration(totalDuration)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-6">
            {album.songs.length > 0 && (
              <div className="bg-black/20 rounded-xl p-4">
                <AlbumTable
                  album={album}
                  songs={album.songs}
                  artist={artist}
                  key={album.id}
                />
              </div>
            )}

            <div className="space-y-6">
              {genres.length > 0 && (
                <div className="bg-black/20 rounded-xl p-4">
                  <h3 className="text-lg font-semibold mb-3 text-white">
                    Genres
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {genres.map((tag) => (
                      <Badge
                        key={tag.name}
                        variant="secondary"
                        className="bg-white/10 hover:bg-white/20 transition"
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {relationships.length > 0 && (
                <div className="bg-black/20 rounded-xl p-4">
                  <h3 className="text-lg font-semibold mb-3 text-white">
                    Links
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {relationships.map((relationship) => {
                      const icon = getRelationshipIcon(relationship.url);
                      return (
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
                              src={icon.src}
                              alt={icon.alt}
                              className="w-8 h-8"
                            />
                          </Button>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {contributingArtists.length > 0 && (
                <div className="bg-black/20 rounded-xl p-4">
                  <h3 className="text-lg font-semibold mb-3 text-white">
                    Featured Artists
                  </h3>
                  <div className="space-y-3">
                    {contributingArtists.map((artist) => (
                      <Link href={`/artist/?id=${artist.id}`} key={artist.id}>
                        <div className="flex items-center gap-3 hover:bg-white/10 p-2 rounded-lg transition">
                          <Image
                            src={
                              artist.icon_url.length === 0
                                ? "/snf.png"
                                : `${getBaseURL()}/image/${encodeURIComponent(
                                    artist.icon_url
                                  )}?raw=true`
                            }
                            alt={artist.name}
                            height={40}
                            width={40}
                            className="rounded-full"
                          />
                          <span className="text-gray-200">{artist.name}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {album.description && (
                <div className="bg-black/20 rounded-xl p-4">
                  <h3 className="text-lg font-semibold mb-3 text-white">
                    About
                  </h3>
                  <Description description={album.description} />
                </div>
              )}
            </div>
          </div>
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
