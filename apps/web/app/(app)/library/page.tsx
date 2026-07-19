import LibraryOverview from "@/features/library/library-overview";
import type { Metadata } from "next";
import RouteLoading from "@/components/app/route-loading";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Library",
  description: "Your music library.",
};

export default function LibraryPage() {
  return (
    <div className="px-5 py-8 pb-36 sm:px-7">
      <Suspense fallback={<RouteLoading />}>
        <LibraryOverview />
      </Suspense>
    </div>
  );
}
