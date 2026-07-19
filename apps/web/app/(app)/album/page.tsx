import { Suspense } from "react";
import AlbumDetails from "./album-details";
import type { Metadata } from "next";
import RouteLoading from "@/components/app/route-loading";

export const metadata: Metadata = {
  title: "Album",
  description: "Album details and tracks.",
};

export default function AlbumPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AlbumDetails />
    </Suspense>
  );
}
