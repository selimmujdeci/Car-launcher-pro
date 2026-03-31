/**
 * In-App Browser — uygulama içi URL açma servisi.
 * Web modunda bridge yerine iframe overlay kullanılır.
 */

type Listener = (url: string | null) => void;

let _current: string | null = null;
const _listeners = new Set<Listener>();

/** Bilinen iframe-engeli olan domain'ler — yeni sekmede aç */
const BLOCKED_HOSTS = [
  'google.com', 'maps.google.com', 'youtube.com', 'spotify.com',
  'waze.com', 'apple.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'play.google.com', 'market://',
];

function isBlocked(url: string): boolean {
  if (url.startsWith('market://')) return true;
  try {
    const host = new URL(url).hostname;
    return BLOCKED_HOSTS.some((b) => host === b || host.endsWith('.' + b));
  } catch {
    return false;
  }
}

export function openInApp(url: string): void {
  // iframe engelleyen siteler → yeni sekme
  if (isBlocked(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  _current = url;
  _listeners.forEach((fn) => fn(_current));
}

export function closeInApp(): void {
  _current = null;
  _listeners.forEach((fn) => fn(null));
}

export function subscribeInApp(fn: Listener): () => void {
  _listeners.add(fn);
  fn(_current); // immediately fire with current state
  return () => _listeners.delete(fn);
}

export function getCurrentUrl(): string | null {
  return _current;
}
