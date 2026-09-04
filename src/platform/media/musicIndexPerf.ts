/** Bounded F2 library telemetry; observation only, no refresh cadence or cache authority. */
const N = 64; const index = new Float64Array(N); const search = new Float64Array(N); let ni = 0; let ns = 0;
const now = () => { try { return performance.now(); } catch { return Date.now(); } };
const put = (a: Float64Array, n: number, ms: number) => { a[n % N] = Math.max(0, ms); return n + 1; };
const p = (a: Float64Array, n: number, q: number) => { const c = Math.min(n, N); if (!c) return null; const v = Array.from(a.subarray(0, c)).sort((x, y) => x - y); return v[Math.min(c - 1, Math.ceil(c * q) - 1)] ?? null; };
export function beginMusicIndexMeasure(): number { return now(); }
export function recordMusicIndexRefresh(start: number): void { ni = put(index, ni, now() - start); }
export function recordMusicSearch(start: number): void { ns = put(search, ns, now() - start); }
export function getMusicIndexPerfSnapshot() { return Object.freeze({ indexSamples: Math.min(ni, N), searchSamples: Math.min(ns, N), indexP50Ms: p(index, ni, .5), indexP95Ms: p(index, ni, .95), searchP50Ms: p(search, ns, .5), searchP95Ms: p(search, ns, .95) }); }
