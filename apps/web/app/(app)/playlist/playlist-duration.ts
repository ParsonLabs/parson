export function formatPlaylistDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";

  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    const parts = [`${days} ${days === 1 ? "day" : "days"}`];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hr" : "hrs"}`);
    if (minutes > 0) parts.push(`${minutes} min`);
    return parts.join(" ");
  }

  if (hours > 0) {
    const parts = [`${hours} ${hours === 1 ? "hr" : "hrs"}`];
    if (minutes > 0) parts.push(`${minutes} min`);
    return parts.join(" ");
  }

  return `${totalMinutes} min`;
}
