import LibraryButtons from "@/components/Layout/LibraryButtons";

export default function PlaylistsPage() {
  return (
    <div className="min-h-screen text-center">
      <LibraryButtons initialSelectedField="Playlists" />
    </div>
  );
}