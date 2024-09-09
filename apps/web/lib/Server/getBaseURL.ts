export default function getBaseURL(): string {
  if (typeof localStorage !== 'undefined') {
    const server = JSON.parse(localStorage.getItem('server') || '{}');
    return server.local_address || '';
  }
  return '';
}