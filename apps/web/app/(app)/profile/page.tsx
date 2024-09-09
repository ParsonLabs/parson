import { Suspense } from "react";
import UsernameComponent from "./UsernameComponent";

export default function ProfilePage() {
  return (
    <Suspense>
      <UsernameComponent />
    </Suspense>
  )
}