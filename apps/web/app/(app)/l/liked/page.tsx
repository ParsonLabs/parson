import LibraryButtons from "@/components/Layout/LibraryButtons";

export default function LikedPage() {
  return (
    <div className="min-h-screen text-center">
      <LibraryButtons initialSelectedField="Songs" />
    </div>
  );
}