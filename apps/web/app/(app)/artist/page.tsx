import { Suspense } from "react";
import ArtistComponent from "./ArtistComponent";

export default function ArtistPage() {
  return (
    <Suspense>
      <ArtistComponent />
    </Suspense>
  )
}
