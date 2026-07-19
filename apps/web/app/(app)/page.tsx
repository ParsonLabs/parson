import LibraryFeed from "@/features/library/library-feed";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
  description: "Recently played music and recommendations.",
};

export default function HomePage() {
  return <LibraryFeed />;
}
