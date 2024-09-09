export default function formatFollowers(followers: number): string {
  if (followers >= 1000000) {
    return (followers / 1000000).toFixed(1) + 'M';
  } else if (followers >= 1000) {
    return (followers / 1000).toFixed(1) + 'K';
  } else {
    return followers.toString();
  }
}