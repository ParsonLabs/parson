import { editSongMetadata, getSongInfo } from "@music/sdk";
import { BareSong } from "@music/sdk/types";
import { Button } from "@music/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@music/ui/components/dialog";
import { Input } from "@music/ui/components/input";
import { ContextMenuItem } from "@radix-ui/react-context-menu";
import { CirclePlus, Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type EditSongDialogProps = {
  song_id: string;
};

export default function EditSongDialog({
  song_id,
}: EditSongDialogProps) {
  const [name, setName] = useState("");
  const [artist, setArtist] = useState("")
  const [contributingArtists, setContributingArtists] = useState<string[]>([]);
  const [contributingArtistIds, setContributingArtistIds] = useState<string[]>([]);
  const [trackNumber, setTrackNumber] = useState<number>(0);
  const [pathValue, setPath] = useState<string>("");
  const [durationValue, setDuration] = useState<number>(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchSongInfo = async () => {
      try {
        const songInfo: BareSong = await getSongInfo(song_id, true);
        setName(songInfo.name);
        setArtist(songInfo.artist)
        setContributingArtists(songInfo.contributing_artists);
        setContributingArtistIds(songInfo.contributing_artist_ids);
        setTrackNumber(songInfo.track_number);
        setPath(songInfo.path);
        setDuration(songInfo.duration);
      } catch (error) {
        console.error("Failed to fetch song info:", error);
      }
    };

    if (open) {
      fetchSongInfo();
    }
  }, [open, song_id]);

  const handleEdit = useCallback(async () => {
    const updatedSong: BareSong = {
      id: song_id,
      name,
      artist,
      contributing_artists: contributingArtists,
      contributing_artist_ids: contributingArtistIds,
      track_number: trackNumber,
      path: pathValue,
      duration: durationValue,
      music_video: undefined,
    };
    try {
      await editSongMetadata(updatedSong);
      setOpen(false);
    } catch (error) {
      console.error("Failed to edit song metadata:", error);
    }
  }, [song_id, name, contributingArtists, contributingArtistIds, trackNumber, pathValue, durationValue, artist]);

  return (
    <Dialog open={open}>
      <DialogTrigger asChild>
          <ContextMenuItem onClick={() => setOpen(true)}>
            <Pencil className="size-5" />
            <p className="pl-3">Edit Metadata</p>
          </ContextMenuItem>
        {/* <Button onClick={() => setOpen(true)}>Edit Metadata</Button> */}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Song Metadata</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Song Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Artist Name</label>
            <Input value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Contributing Artists</label>
            <Input value={contributingArtists.join(", ")} onChange={(e) => setContributingArtists(e.target.value.split(", "))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Contributing Artist IDs</label>
            <Input value={contributingArtistIds.join(", ")} onChange={(e) => setContributingArtistIds(e.target.value.split(", "))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Track Number</label>
            <Input type="number" value={trackNumber} onChange={(e) => setTrackNumber(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Path</label>
            <Input value={pathValue} onChange={(e) => setPath(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Duration</label>
            <Input type="number" value={durationValue} onChange={(e) => setDuration(Number(e.target.value))} />
          </div>
          <Button onClick={handleEdit}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}