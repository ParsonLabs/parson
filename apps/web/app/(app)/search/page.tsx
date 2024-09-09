import { Suspense } from "react";
import SearchComponent from "./SearchComponent";

export default function SearchPage() {
  return (
    <Suspense>
      <SearchComponent />
    </Suspense>
  )
}