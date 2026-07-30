"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteUser,
  getUsers,
  register,
  validPasswordLength,
} from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, UserRound } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useSession } from "@/features/account/session-provider";

export default function UserForm() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    Awaited<ReturnType<typeof getUsers>>[number] | null
  >(null);
  const requestInFlight = useRef(false);
  const users = useQuery({ queryKey: ["settings-users"], queryFn: getUsers });

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requestInFlight.current) return;
    if (!validPasswordLength(password)) {
      toast("Password must contain between 8 and 256 characters.");
      return;
    }
    requestInFlight.current = true;
    setSaving(true);
    try {
      const result = await register({ username, password, role });
      if (!result.status) {
        toast(result.message || "Could not create user.");
        return;
      }
      setUsername("");
      setPassword("");
      setRole("user");
      setOpen(false);
      await users.refetch();
      toast.success("User created.");
    } catch {
      toast("Could not create user.");
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            People with access
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Administrators manage Parson. Listeners can play music and manage
            their own collection.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add user
        </Button>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-white/10">
        {users.isLoading ? (
          <div className="flex h-20 items-center justify-center text-zinc-500">
            <Loader2
              aria-label="Loading users"
              className="h-4 w-4 animate-spin"
            />
          </div>
        ) : users.data?.length ? (
          users.data.map((user) => (
            <div
              className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-4 last:border-0"
              key={user.id}
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-zinc-400">
                <UserRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {user.username}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {user.role === "admin" ? "Administrator" : "Listener"}
                </p>
              </div>
              <Button
                aria-label={`Delete ${user.username}`}
                disabled={String(user.id) === session?.sub}
                onClick={() => setDeleteTarget(user)}
                size="icon"
                title={
                  String(user.id) === session?.sub
                    ? "You cannot delete your current account"
                    : `Delete ${user.username}`
                }
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          ))
        ) : (
          <p className="px-4 py-5 text-sm text-zinc-500">
            Users could not be loaded.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Create a separate account for someone who uses this library.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={createUser}>
            <label className="grid gap-2 text-sm text-zinc-300">
              Username
              <Input
                autoComplete="off"
                autoFocus
                maxLength={64}
                minLength={1}
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
            </label>
            <label className="grid gap-2 text-sm text-zinc-300">
              Password
              <Input
                autoComplete="new-password"
                maxLength={256}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <label className="grid gap-2 text-sm text-zinc-300">
              Role
              <Select
                onValueChange={(value) => setRole(value as "admin" | "user")}
                value={role}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Listener</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <DialogFooter className="mt-2 gap-2">
              <Button
                onClick={() => setOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={saving} type="submit">
                {saving ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.username}?</DialogTitle>
            <DialogDescription>
              Parson creates a safety backup first, then permanently removes
              this account, its listening data, favorites, and owned playlists.
              Music files are not changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={deleting || !deleteTarget}
              onClick={() => {
                if (!deleteTarget) return;
                const target = deleteTarget;
                setDeleting(true);
                void deleteUser(target.id)
                  .then(async () => {
                    setDeleteTarget(null);
                    await users.refetch();
                    toast.success(`${target.username} was deleted.`);
                  })
                  .catch(() => {
                    toast.error(
                      "The user could not be deleted. Parson always keeps at least one administrator.",
                    );
                  })
                  .finally(() => setDeleting(false));
              }}
              variant="destructive"
            >
              {deleting ? "Deleting…" : "Delete user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
