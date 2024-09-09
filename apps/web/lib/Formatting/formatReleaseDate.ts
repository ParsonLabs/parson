export default function formatReleaseDate(releaseDateString: string): string {
  return new Date(releaseDateString).toLocaleString('default', { month: 'long', year: 'numeric' });
}