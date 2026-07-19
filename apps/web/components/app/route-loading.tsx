export default function RouteLoading() {
  return (
    <div
      aria-label="Loading"
      className="grid min-h-[60vh] place-items-center"
      role="status"
    >
      <div className="h-2 w-2 animate-pulse rounded-full bg-white/70" />
    </div>
  );
}
