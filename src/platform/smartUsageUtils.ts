import type { UsageRecord, UsageMap, TimeContext } from './smartTypes';
import { USAGE_KEY, PRUNE_KEY, DAY_MS, MAX_USAGE_ENTRIES, TIME_BIAS } from './smartConstants';

export function loadUsage(): UsageMap {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? (JSON.parse(raw) as UsageMap) : {};
  } catch {
    return {};
  }
}

export function saveUsage(map: UsageMap): void {
  let toSave = map;
  const keys = Object.keys(map);
  if (keys.length > MAX_USAGE_ENTRIES) {
    // Keep the 200 most recently used entries
    const sorted = keys.sort((a, b) => (map[b]?.lastUsed ?? 0) - (map[a]?.lastUsed ?? 0));
    toSave = Object.fromEntries(sorted.slice(0, MAX_USAGE_ENTRIES).map((k) => [k, map[k]])) as UsageMap;
  }
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(toSave)); } catch { /* quota full */ }
}

/** Reset recentCount for all apps once per 24-h window. */
export function pruneIfStale(map: UsageMap): UsageMap {
  const lastPrune = Number(localStorage.getItem(PRUNE_KEY) ?? 0);
  if (Date.now() - lastPrune < DAY_MS) return map;
  const pruned: UsageMap = {};
  for (const [id, rec] of Object.entries(map)) {
    pruned[id] = { ...rec, recentCount: 0 };
  }
  try { localStorage.setItem(PRUNE_KEY, String(Date.now())); } catch { /* ignore */ }
  return pruned;
}

/* ── Usage cache — avoids repeated localStorage.getItem + JSON.parse ── */

let _usageCache: UsageMap | null = null;

export function getCachedUsage(): UsageMap {
  if (_usageCache) {
    // localStorage dışarıdan temizlendiyse (test teardown, OS kota temizliği,
    // safeStorage LRU eviction) cache'i geçersizleştir — stale veri önlenir.
    if (!localStorage.getItem(USAGE_KEY)) _usageCache = null;
  }
  if (!_usageCache) {
    _usageCache = pruneIfStale(loadUsage());
  }
  return _usageCache;
}

/** Cache'i doğrudan güncelle — trackLaunch sonrası localStorage re-read önler. */
export function setUsageCache(map: UsageMap): void {
  _usageCache = map;
}

/** Cache'i sıfırla — HMR cleanup ve test teardown için. */
export function clearUsageCache(): void {
  _usageCache = null;
}

/**
 * Composite score: lifetime count (30 %) + 24-h count (50 %) + recency decay (20 %).
 * Recency bonus fades linearly to 0 over 24 h.
 */
export function score(rec: UsageRecord | undefined): number {
  if (!rec) return 0;
  const recency = rec.lastUsed > 0
    ? Math.max(0, 1 - (Date.now() - rec.lastUsed) / DAY_MS)
    : 0;
  return rec.count * 0.3 + rec.recentCount * 0.5 + recency * 0.2;
}

export function timedScore(id: string, map: UsageMap, ctx: TimeContext): number {
  return score(map[id]) + (TIME_BIAS[ctx][id] ?? 0);
}

export function getTimeContext(): TimeContext {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}
