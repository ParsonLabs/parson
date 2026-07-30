"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/features/account/session-provider";
import { changeUsername, validUsername } from "@parson/music-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

export function UsernameForm() {
  const { session, setSession } = useSession();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(session?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const requestInFlight = useRef(false);

  useEffect(() => {
    setUsername(session?.username ?? "");
  }, [session?.username]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    const requestedUsername = username.trim();
    if (!validUsername(requestedUsername)) {
      toast("Username must contain between 1 and 64 characters.");
      return;
    }
    requestInFlight.current = true;
    setSaving(true);
    try {
      const response = await changeUsername(requestedUsername, currentPassword);
      if (!response.status || !response.claims)
        throw new Error(response.message || "Username update failed.");
      setSession(response.claims);
      await queryClient.invalidateQueries({ queryKey: ["settings-users"] });
      setCurrentPassword("");
      toast.success("Username updated.");
    } catch {
      toast.error(
        "Could not update the username. Check the password and make sure the name is available.",
      );
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="max-w-md space-y-4" onSubmit={submit}>
      <label className="grid gap-2 text-sm text-zinc-300">
        Username
        <Input
          aria-label="Username"
          autoComplete="username"
          maxLength={64}
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </label>
      <label className="grid gap-2 text-sm text-zinc-300">
        Current password
        <Input
          aria-label="Current password for username change"
          autoComplete="current-password"
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </label>
      <Button
        disabled={
          saving ||
          !currentPassword ||
          username.trim() === session?.username ||
          !validUsername(username.trim())
        }
        type="submit"
      >
        {saving ? "Updating…" : "Update username"}
      </Button>
    </form>
  );
}
