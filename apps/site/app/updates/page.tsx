import type { Metadata } from "next";
import Downloads from "./downloads";

export const metadata: Metadata = {
  title: { absolute: "Parson Downloads" },
  description: "Download Parson for Windows, macOS and Linux.",
  alternates: { canonical: "https://parson.dev/updates" },
};

export default function UpdatesPage() {
  return <Downloads />;
}
