export default function getBaseURL(): string {
  if (typeof window !== 'undefined') {
    if (typeof localStorage !== 'undefined') {
      const serverConfig = localStorage.getItem('server_url');
      if (serverConfig) {
        return serverConfig;
      }
    }
    
    const url = new URL(window.location.href);
    if (url.hostname === 'localhost' && url.port === '3000') {
      return `${url.protocol}//${url.hostname}:3001`;
    }
    
    return window.location.origin;
  }
  
  return '';
}