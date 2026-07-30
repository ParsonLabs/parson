"use client";

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import getBaseURL from "@/lib/api/server-url";
import { defaultCover } from "@/lib/images/default-cover";
import { getLibraryImageUrl } from "@/lib/images/image-url";
import type { LibraryMetadataPatch } from "@parson/music-sdk/types";
import { ChevronDown, Pencil } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

type Section = "song" | "album" | "artist";
export type MetadataUpdater = (
  section: Section,
  field: string,
  value: string,
) => void;

function MetadataField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string | number | null;
  onChange: (value: string) => void;
}) {
  const id = `metadata-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return (
    <Input
      aria-label={label}
      id={id}
      placeholder={label}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function AlbumArtworkField({
  coverFile,
  coverUrl,
  onCoverSelect,
}: {
  coverFile?: File | null;
  coverUrl?: string | null;
  onCoverSelect?: (file: File | null) => void;
}) {
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!coverFile) {
      setSelectedPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(coverFile);
    setSelectedPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [coverFile]);

  const image =
    selectedPreview ?? getLibraryImageUrl(coverUrl, getBaseURL) ?? defaultCover;

  return (
    <Field className="w-fit">
      <label className="group relative block h-32 w-32 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-lg shadow-black/40">
        <Image
          alt="Album art"
          className="pointer-events-none object-cover"
          draggable={false}
          fill
          sizes="128px"
          src={image}
          unoptimized={image.startsWith("blob:")}
        />
        <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/15" />
        <span className="pointer-events-none absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/75 text-white shadow-lg transition-transform group-hover:scale-105">
          <Pencil aria-hidden="true" className="h-4 w-4" />
        </span>
        <input
          accept="image/*"
          aria-label="Choose album art"
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none"
          onChange={(event) => onCoverSelect?.(event.target.files?.[0] ?? null)}
          type="file"
        />
      </label>
    </Field>
  );
}

export function MetadataFields({
  coverFile,
  mode = "song",
  onCoverSelect,
  patch,
  showAdvanced,
  toggleAdvanced,
  update,
}: {
  coverFile?: File | null;
  mode?: "song" | "album";
  onCoverSelect?: (file: File | null) => void;
  patch: LibraryMetadataPatch;
  showAdvanced: boolean;
  toggleAdvanced: () => void;
  update: MetadataUpdater;
}) {
  const albumPrimary = mode === "album";
  return (
    <FieldGroup>
      {!albumPrimary && (
        <MetadataField
          label="Song title"
          value={patch.song?.name}
          onChange={(value) => update("song", "name", value)}
        />
      )}

      {albumPrimary && (
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <AlbumArtworkField
            coverFile={coverFile}
            coverUrl={patch.album?.cover_url}
            onCoverSelect={onCoverSelect}
          />
          <Field className="min-w-0 flex-1">
            <MetadataField
              label="Album Name"
              value={patch.album?.name}
              onChange={(value) => update("album", "name", value)}
            />
          </Field>
        </div>
      )}

      <Field className="gap-1">
        <button
          type="button"
          aria-expanded={showAdvanced}
          className="flex h-10 items-center justify-between rounded-md bg-white/[0.035] px-3 text-left text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
          onClick={toggleAdvanced}
        >
          {albumPrimary ? "Advanced options" : "Advanced metadata"}
          <ChevronDown
            className={`size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          />
        </button>
      </Field>

      {showAdvanced && (
        <div className="grid gap-4 sm:grid-cols-2">
          {!albumPrimary && (
            <>
              <MetadataField
                label="Artist credit"
                value={patch.song?.artist}
                onChange={(value) => update("song", "artist", value)}
              />
              <MetadataField
                label="Track number"
                value={patch.song?.track_number}
                onChange={(value) => update("song", "track_number", value)}
              />
              <MetadataField
                label="Album name"
                value={patch.album?.name}
                onChange={(value) => update("album", "name", value)}
              />
              <MetadataField
                label="Duration (seconds)"
                value={patch.song?.duration}
                onChange={(value) => update("song", "duration", value)}
              />
            </>
          )}
          <MetadataField
            label="Artist name"
            value={patch.artist?.name}
            onChange={(value) => update("artist", "name", value)}
          />
          <MetadataField
            label="Release date"
            value={patch.album?.first_release_date}
            onChange={(value) => update("album", "first_release_date", value)}
          />
          <MetadataField
            label="Album type"
            value={patch.album?.primary_type}
            onChange={(value) => update("album", "primary_type", value)}
          />
          {!albumPrimary && (
            <>
              <div className="sm:col-span-2">
                <MetadataField
                  label="File path"
                  value={patch.song?.path}
                  onChange={(value) => update("song", "path", value)}
                />
              </div>
              <div className="sm:col-span-2">
                <MetadataField
                  label="Cover URL"
                  value={patch.album?.cover_url}
                  onChange={(value) => update("album", "cover_url", value)}
                />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Textarea
              aria-label="Album description"
              id="metadata-album-description"
              placeholder="Album description"
              onChange={(event) =>
                update("album", "description", event.target.value)
              }
              value={patch.album?.description ?? ""}
            />
          </div>
        </div>
      )}
    </FieldGroup>
  );
}
