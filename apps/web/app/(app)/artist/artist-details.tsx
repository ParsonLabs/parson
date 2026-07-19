"use client";

import { AlbumArtFallback, getLibraryImageUrl } from "@/lib/images/image-url";
import getBaseURL from "@/lib/api/server-url";
import { Album, Artist } from "@parson/music-sdk/types";
import { useArtist } from "@/features/library/use-library-entity";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { usePageTitle } from "@/components/app/title-metadata";
import EntityPageState from "@/features/library/entity-page-state";
import AlbumMenu from "@/features/library/album-menu";

type ArtistDetailsProps = {
  devArtist?: Artist;
  devAlbums?: Album[];
};

const sortAlbumsByReleaseDate = (albums: Album[]) =>
  [...albums].sort((left, right) => {
    const leftTime = Date.parse(left.first_release_date || "");
    const rightTime = Date.parse(right.first_release_date || "");
    const safeLeft = Number.isFinite(leftTime) ? leftTime : -Infinity;
    const safeRight = Number.isFinite(rightTime) ? rightTime : -Infinity;
    return safeRight - safeLeft;
  });

export default function ArtistDetails({
  devArtist,
  devAlbums,
}: ArtistDetailsProps = {}) {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  const artistQuery = useArtist(id, devArtist);
  const artist = artistQuery.data ?? null;
  usePageTitle(artist?.name);
  const albums = devAlbums ?? artist?.albums ?? [];

  const artistIconURL = useMemo(
    () => getLibraryImageUrl(artist?.icon_url, getBaseURL),
    [artist?.icon_url],
  );

  const discographySections = useMemo(() => {
    if (artist?.discography?.length) {
      return artist.discography.map((section) => ({
        ...section,
        albums: sortAlbumsByReleaseDate(section.albums),
      }));
    }

    return albums.length
      ? [
          {
            key: "albums",
            title: "Albums",
            albums: sortAlbumsByReleaseDate(albums),
          },
        ]
      : [];
  }, [albums, artist?.discography]);
  if (!id && !devArtist) return <EntityPageState kind="artist" />;
  if (artistQuery.isPending) return <EntityPageState kind="artist" loading />;
  if (artistQuery.isError || !artist)
    return (
      <EntityPageState
        kind="artist"
        onRetry={() => void artistQuery.refetch()}
      />
    );

  return (
    <div className="tidal-route relative text-zinc-50">
      <div className="hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-80"
          style={{
            backgroundImage: artistIconURL
              ? `url(${artistIconURL})`
              : undefined,
          }}
        />
        <div className="absolute inset-0 bg-black/45" />
      </div>

      <div className="relative z-10 mx-auto max-w-[900px] px-5 pb-24 pt-10 sm:px-7">
        <div className="mb-10 flex items-end gap-5">
          {artistIconURL && (
            <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-full border border-white/10 sm:h-40 sm:w-40">
              <Image
                src={artistIconURL}
                alt={artist.name}
                fill
                className="object-cover"
                sizes="160px"
                priority
              />
            </div>
          )}
          <h1 className="min-w-0 break-words text-4xl font-black leading-none text-white sm:text-6xl">
            {artist.name}
          </h1>
        </div>

        <div className="space-y-12">
          {discographySections.length > 0 && (
            <div className="space-y-12">
              {discographySections.map((section) => (
                <section key={section.key}>
                  <h3 className="mb-5 text-xl font-semibold text-white">
                    {section.title}
                  </h3>
                  <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                    {section.albums.map((album) => (
                      <AlbumMenu
                        album_id={album.id}
                        artist_id={artist.id}
                        key={album.id}
                        showArtist={false}
                      >
                        <Link
                          href={`/album?id=${album.id}`}
                          className="group min-w-0 max-w-[190px] cursor-pointer"
                        >
                          <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
                            {getLibraryImageUrl(album.cover_url, getBaseURL) ? (
                              <Image
                                src={
                                  getLibraryImageUrl(
                                    album.cover_url,
                                    getBaseURL,
                                  ) ?? ""
                                }
                                alt={album.name}
                                fill
                                className="object-cover transition-transform duration-500 group-hover:scale-105"
                                sizes="220px"
                              />
                            ) : (
                              <AlbumArtFallback />
                            )}
                            <div className="absolute inset-0 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100" />
                          </div>
                          <div className="mt-3 min-w-0">
                            <h4
                              className="truncate text-sm font-semibold leading-5 text-zinc-100"
                              title={album.name}
                            >
                              {album.name}
                            </h4>
                            <p className="truncate text-xs text-zinc-400">
                              {album.primary_type || "Album"}
                            </p>
                          </div>
                        </Link>
                      </AlbumMenu>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
