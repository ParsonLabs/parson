import type { Metadata } from "next";
import PlaylistDetails from "./playlist-details";
import RouteLoading from "@/components/app/route-loading";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Playlist",
  description: "Play and manage a playlist.",
};

export default function PlaylistPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <PlaylistDetails />
    </Suspense>
  );
}
