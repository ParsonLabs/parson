"use client";

import { register } from "@parson/music-sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useRef, useState, type FormEvent } from "react";

export default function UserForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requestInFlight = useRef(false);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setSaving(true);
    setMessage("");
    try {
      const result = await register({
        username,
        password,
        role: admin ? "admin" : "user",
      });
      if (!result.status) {
        setMessage(result.message || "Could not create user.");
        return;
      }
      setUsername("");
      setPassword("");
      setAdmin(false);
      setMessage("User created.");
    } catch {
      setMessage("Could not create user.");
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <form onSubmit={createUser} className="max-w-lg space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          aria-label="Username"
          id="new-username"
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          minLength={2}
          required
          className="border-zinc-800 bg-black focus-visible:ring-zinc-600"
        />
        <Input
          aria-label="Password"
          id="new-password"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
          className="border-zinc-800 bg-black focus-visible:ring-zinc-600"
        />
      </div>
      <label
        className="flex cursor-pointer items-center gap-3 text-sm text-zinc-400"
        htmlFor="new-user-administrator"
      >
        <Checkbox
          checked={admin}
          id="new-user-administrator"
          onCheckedChange={(checked) => setAdmin(checked === true)}
        />
        Administrator
      </label>
      <Button
        type="submit"
        disabled={saving}
        className="bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
      >
        {saving ? "Creating..." : "Create user"}
      </Button>
      {message && <p className="text-sm text-zinc-400">{message}</p>}
    </form>
  );
}
