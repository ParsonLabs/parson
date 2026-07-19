import type { Metadata } from "next";
import InteractiveProductDemo from "../../components/interactive-product-demo";

export const metadata: Metadata = {
  title: "Parson product showcase",
  robots: { follow: false, index: false },
};

function numberParameter(
  value: string | string[] | undefined,
  fallback: number,
) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async function ShowcasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parameters = await searchParams;
  return (
    <main className="showcase-capture">
      <InteractiveProductDemo
        initialAlbumId={
          Array.isArray(parameters.album)
            ? parameters.album[0]
            : parameters.album
        }
        initialPlaying={parameters.playing === "true"}
        initialPanel={
          parameters.panel === "lyrics" || parameters.panel === "queue"
            ? parameters.panel
            : undefined
        }
        initialQuery={
          Array.isArray(parameters.query)
            ? parameters.query[0]
            : parameters.query
        }
        initialTime={numberParameter(parameters.time, 42)}
        initialTrackIndex={numberParameter(parameters.track, 0)}
        initialView={
          parameters.view === "album" ||
          parameters.view === "artist" ||
          parameters.view === "library" ||
          parameters.view === "settings"
            ? parameters.view
            : "home"
        }
      />
    </main>
  );
}
