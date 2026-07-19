import { Suspense } from "react";
import SearchResults from "./search-results";
import type { Metadata } from "next";
import RouteLoading from "@/components/app/route-loading";

export const metadata: Metadata = {
  title: "Search",
  description: "Search your music library.",
};

export default function SearchPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <SearchResults />
    </Suspense>
  );
}
