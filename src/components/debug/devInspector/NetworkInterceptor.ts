export interface NetEntry {
  id:         number;
  method:     string;
  url:        string;         // query & hash stripped — no PII
  status:     number | null;
  durationMs: number | null;
  ts:         number;
  failed:     boolean;
}

const MAX_RING = 100;
const _ring: NetEntry[] = [];
let   _id      = 0;
let   _patched = false;
let   _orig: typeof window.fetch | null = null;

function idle(cb: () => void): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(cb, { timeout: 500 });
  } else {
    setTimeout(cb, 0);
  }
}

function sanitize(raw: string): string {
  try {
    const u = new URL(raw, window.location.href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return (raw.split('?')[0] ?? raw).split('#')[0] ?? raw;
  }
}

function push(e: NetEntry): void {
  if (_ring.length >= MAX_RING) _ring.shift();
  _ring.push(e);
}

export function installNetworkInterceptor(): () => void {
  if (_patched || typeof window === 'undefined') return () => {};
  _patched = true;
  _orig    = window.fetch.bind(window);

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const rawUrl =
      typeof input === 'string'  ? input
      : input instanceof URL     ? input.href
      : (input as Request).url;
    const url    = sanitize(rawUrl);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const id     = _id++;
    const t0     = performance.now();
    const entry: NetEntry = { id, method, url, status: null, durationMs: null, ts: Date.now(), failed: false };

    idle(() => push(entry));

    return _orig!(input, init).then(
      (res) => {
        const d = Math.round(performance.now() - t0);
        idle(() => { entry.status = res.status; entry.durationMs = d; });
        return res;
      },
      (err: unknown) => {
        const d = Math.round(performance.now() - t0);
        idle(() => { entry.status = 0; entry.durationMs = d; entry.failed = true; });
        throw err;
      },
    );
  };

  return () => {
    if (_orig) window.fetch = _orig;
    _orig    = null;
    _patched = false;
  };
}

export function getNetworkEntries(): readonly NetEntry[] { return _ring; }
export function clearNetworkEntries(): void              { _ring.length = 0; }
