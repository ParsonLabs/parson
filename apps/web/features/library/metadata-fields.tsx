"use client";

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LibraryMetadataPatch } from "@parson/music-sdk/types";
import { ChevronDown } from "lucide-react";

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

export function MetadataFields({
  mode = "song",
  onCoverSelect,
  patch,
  showAdvanced,
  toggleAdvanced,
  update,
}: {
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

      {!albumPrimary && (
        <Field className="gap-1">
          <button
            type="button"
            aria-expanded={showAdvanced}
            className="flex h-10 items-center justify-between rounded-md bg-white/[0.035] px-3 text-left text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
            onClick={toggleAdvanced}
          >
            Advanced metadata
            <ChevronDown
              className={`size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>
        </Field>
      )}

      {(albumPrimary || showAdvanced) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {albumPrimary && (
            <>
              <Field>
                <FieldLabel>Album name</FieldLabel>
                <MetadataField
                  label="Album name"
                  value={patch.album?.name}
                  onChange={(value) => update("album", "name", value)}
                />
              </Field>
              <Field>
                <FieldLabel>Album cover</FieldLabel>
                <Input
                  accept="image/*"
                  aria-label="Upload album cover"
                  onChange={(event) =>
                    onCoverSelect?.(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </Field>
            </>
          )}
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
          <MetadataField
            label="Artist image URL"
            value={patch.artist?.icon_url}
            onChange={(value) => update("artist", "icon_url", value)}
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
