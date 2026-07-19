"use client";

import { editLibraryMetadata, getSongInfo } from "@parson/music-sdk";
import type {
  LibraryMetadataPatch,
  LibrarySong,
} from "@parson/music-sdk/types";
import { useEffect, useRef, useState } from "react";
import {
  changedMetadata,
  hasMetadataChanges,
  validateMetadata,
} from "./metadata-state";
import type { MetadataUpdater } from "./metadata-fields";
import { toast } from "sonner";

const emptyPatch: LibraryMetadataPatch = { song: {}, album: {}, artist: {} };

function editableMetadata(song: LibrarySong): LibraryMetadataPatch {
  return {
    song: {
      name: song.name,
      artist: song.artist,
      track_number: song.track_number,
      path: song.path,
      duration: song.duration,
    },
    album: {
      name: song.album_object.name,
      cover_url: song.album_object.cover_url,
      first_release_date: song.album_object.first_release_date,
      primary_type: song.album_object.primary_type,
      description: song.album_object.description,
    },
    artist: {
      name: song.artist_object.name,
      icon_url: song.artist_object.icon_url,
      description: song.artist_object.description,
    },
  };
}

export function useMetadataEditor({
  controlledOpen,
  onOpenChange,
  onSaved,
  songId,
}: {
  controlledOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved: () => void;
  songId: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [patch, setPatch] = useState<LibraryMetadataPatch>(emptyPatch);
  const original = useRef<LibraryMetadataPatch | null>(null);
  const requestGeneration = useRef(0);
  const saveInFlight = useRef(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };

  useEffect(() => {
    if (!error) return;
    toast(error, { id: "song-metadata-error" });
    setError("");
  }, [error]);

  useEffect(() => {
    if (!open) return;
    const generation = ++requestGeneration.current;
    let cancelled = false;
    original.current = null;
    setError("");
    setLoading(true);
    setSaving(false);
    getSongInfo(songId, false)
      .then((value) => {
        if (cancelled || generation !== requestGeneration.current) return;
        const loaded = editableMetadata(value as LibrarySong);
        original.current = loaded;
        setPatch(loaded);
      })
      .catch(() => {
        if (!cancelled && generation === requestGeneration.current)
          setError("Could not load metadata.");
      })
      .finally(() => {
        if (!cancelled && generation === requestGeneration.current)
          setLoading(false);
      });
    return () => {
      cancelled = true;
      if (requestGeneration.current === generation)
        requestGeneration.current += 1;
    };
  }, [open, songId]);

  const update: MetadataUpdater = (section, field, value) =>
    setPatch((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]:
          field === "track_number" || field === "duration"
            ? Number(value)
            : value,
      },
    }));

  const save = async () => {
    if (saveInFlight.current) return;
    const baseline = original.current;
    if (!baseline) {
      setError("Metadata has not finished loading.");
      return;
    }
    const changes = changedMetadata(baseline, patch);
    const validationError = validateMetadata(changes);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!hasMetadataChanges(changes)) {
      setOpen(false);
      return;
    }
    const generation = requestGeneration.current;
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await editLibraryMetadata(songId, changes);
      if (generation !== requestGeneration.current) return;
      setOpen(false);
      onSaved();
    } catch {
      if (generation === requestGeneration.current)
        setError("Could not save metadata.");
    } finally {
      saveInFlight.current = false;
      if (generation === requestGeneration.current) setSaving(false);
    }
  };

  return {
    error,
    loaded: Boolean(original.current),
    loading,
    open,
    patch,
    save,
    saving,
    setOpen,
    update,
  };
}
