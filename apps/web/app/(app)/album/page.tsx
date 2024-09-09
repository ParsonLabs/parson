import { Suspense } from "react";
import AlbumComponent from "./AlbumComponent";

export default function AlbumPage() {
  return (
    <Suspense>
      <AlbumComponent />
    </Suspense>
  )
}