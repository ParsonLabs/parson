"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login, refreshMediaToken } from "@parson/music-sdk";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/account/session-provider";
import { toast } from "sonner";
import Link from "next/link";
import ParsonBrandMark from "@/components/icons/parson-brand-mark";

export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedLibrary, setSelectedLibrary] = useState("");
  const [libraryAddress, setLibraryAddress] = useState("");

  useEffect(() => {
    const name = new URLSearchParams(window.location.search)
      .get("library")
      ?.trim();
    if (!name) return;
    setSelectedLibrary(name);
    try {
      const configured = window.localStorage.getItem("server_url");
      setLibraryAddress(configured ? new URL(configured).host : "");
    } catch {
      setLibraryAddress("");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await login({ username, password });
      if (!result.status) {
        toast(result.message || "Sign in failed.");
        return;
      }
      if (!result.claims) throw new Error("Sign in response had no session");
      const media = await refreshMediaToken();
      if (!media.status || !media.media_token) {
        throw new Error("Media authorization unavailable");
      }
      setSession(result.claims);
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next === "/setup" ? next : "/");
    } catch {
      toast("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen min-h-dvh items-center justify-center px-5 py-24">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200"
      >
        <ParsonBrandMark className="mb-7 h-16 w-16 sm:hidden" />
        <div className="pb-2">
          <h1 className="text-3xl font-bold tracking-tight">
            {selectedLibrary ? `Sign in to ${selectedLibrary}` : "Welcome back"}
          </h1>
          {libraryAddress && (
            <p className="mt-2 text-sm text-zinc-500">{libraryAddress}</p>
          )}
        </div>
        <Input
          aria-label="Username"
          autoComplete="username"
          className="h-12 rounded-xl px-4 text-base"
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          aria-label="Password"
          autoComplete="current-password"
          className="h-12 rounded-xl px-4 text-base"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button
          className="h-12 w-full rounded-full bg-white text-base text-black hover:bg-zinc-200"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        <Link
          className="block min-h-12 rounded-full py-3 text-center text-sm font-medium text-zinc-500 hover:bg-white/[0.04] hover:text-white"
          href="/connect"
        >
          {selectedLibrary
            ? "Choose another library"
            : "Connect to another library"}
        </Link>
      </form>
    </main>
  );
}
