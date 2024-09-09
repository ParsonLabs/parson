import PlaylistComponent from "./PlaylistComponent";
import { Suspense } from "react";

export default function PlaylistPage() {
  return (
    <Suspense>
      <PlaylistComponent />
    </Suspense>
  )
}