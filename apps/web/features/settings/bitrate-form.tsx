"use client";

import { setBitrate } from "@parson/music-sdk";
import { useSession } from "@/features/account/session-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useRef, useState, type FormEvent } from "react";

const bitrates = { low: 96, normal: 128, high: 256, lossless: 0 } as const;
type Quality = keyof typeof bitrates;

function qualityFromBitrate(bitrate: number): Quality {
  if (bitrate === 0) return "lossless";
  if (bitrate === 96) return "low";
  if (bitrate === 128) return "normal";
  if (bitrate === 256) return "high";
  return "normal";
}

export default function BitrateForm({
  initialBitrate,
}: {
  initialBitrate: number;
}) {
  const { session, setSession } = useSession();
  const [quality, setQuality] = useState<Quality>(() =>
    qualityFromBitrate(initialBitrate),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requestInFlight = useRef(false);

  useEffect(() => {
    const savedQuality = qualityFromBitrate(initialBitrate);
    setQuality(savedQuality);
  }, [initialBitrate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    const bitrate = bitrates[quality];
    requestInFlight.current = true;
    setSaving(true);
    setMessage("");
    try {
      await setBitrate(bitrate);
      if (session) setSession({ ...session, bitrate });
      setMessage("Quality updated.");
    } catch {
      setMessage("Could not update quality.");
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-5">
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-200">
          Streaming quality
        </label>
        <Select
          value={quality}
          onValueChange={(value) => setQuality(value as Quality)}
        >
          <SelectTrigger aria-label="Streaming quality" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low · 96 kbps</SelectItem>
            <SelectItem value="normal">Normal · 128 kbps</SelectItem>
            <SelectItem value="high">High · 256 kbps</SelectItem>
            <SelectItem value="lossless">Original</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-2 text-sm text-zinc-500">
          {quality === "lossless"
            ? "Streams the source file without transcoding."
            : "Uses less bandwidth by transcoding while you listen."}
        </p>
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Applying…" : "Apply quality"}
      </Button>
      {message && (
        <p aria-live="polite" className="basis-full text-sm text-zinc-500">
          {message}
        </p>
      )}
    </form>
  );
}
