import LibraryButtons from "@/components/Layout/LibraryButtons";

export default function ArtistsPage() {
  return (
    <div className="min-h-screen text-center">
      <LibraryButtons initialSelectedField="Artists" />
    </div>
  );
}