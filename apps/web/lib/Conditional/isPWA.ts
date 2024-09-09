declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export default function isPWA(): boolean {
  if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }

  if (typeof navigator === 'object' && navigator.standalone) {
    return true;
  }

  return false;
}