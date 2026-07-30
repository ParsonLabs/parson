"use client";

import { changePassword, logout, validPasswordLength } from "@parson/music-sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const requestInFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    if (!validPasswordLength(newPassword)) {
      toast("New password must contain between 8 and 256 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast("New passwords do not match.");
      return;
    }
    requestInFlight.current = true;
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated. Sign in again.");
      await logout().catch(() => {});
      window.location.assign("/login");
    } catch {
      toast("Could not update password.");
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm text-zinc-300">
          Current password
          <Input
            aria-label="Current password"
            autoComplete="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label className="grid gap-2 text-sm text-zinc-300">
          New password
          <Input
            aria-label="New password"
            autoComplete="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={8}
            maxLength={256}
            required
          />
        </label>
        <label className="grid gap-2 text-sm text-zinc-300">
          Confirm new password
          <Input
            aria-label="Confirm new password"
            autoComplete="new-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            minLength={8}
            maxLength={256}
            required
          />
        </label>
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
