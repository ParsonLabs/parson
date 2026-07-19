import { Suspense } from "react";
import ArtistDetails from "./artist-details";
import type { Metadata } from "next";
import RouteLoading from "@/components/app/route-loading";

export const metadata: Metadata = {
  title: "Artist",
  description: "Artist details and releases.",
};

export default function ArtistPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <ArtistDetails />
    </Suspense>
  );
}
