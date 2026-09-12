/**
 * recentSearches.ts — F5 · Son aramalar (bounded, yerel, açıkça temizlenebilir).
 *
 * SINIRLAR:
 *   · Yalnız CİHAZDA kalır; hiçbir yere gönderilmez.
 *   · Sabit üst sınır — sınırsız büyüme yok.
 *   · Normalize edilmiş anahtarla tekilleştirilir ("Sezen" ve "sezen" tek kayıt),
 *     ama kullanıcıya GÖSTERİLEN metin kendi yazdığı hâlidir.
 *   · **Öneri otoritesi DEĞİLDİR.** Geçmiş, sıralamayı veya keşfi etkilemez;
 *     yalnız kullanıcının kendi yazdığını tekrar yazmasını engeller.
 *   · Telemetriye sorgu METNİ gitmez — yalnız adet.
 */
import { safeStorage } from '../../../utils/safeStorage';
import { searchKey } from './searchNormalize';

export const MAX_RECENT_SEARCHES = 12;
const STORAGE_KEY = 'caros.music.recentSearches.v1';

export interface RecentSearch {
  /** Kullanıcının yazdığı hâli — gösterim bunu kullanır. */
  readonly text: string;
  /** Tekilleştirme anahtarı. */
  readonly key: string;
  readonly atMs: number;
}

let cache: readonly RecentSearch[] | null = null;

function parse(raw: string | null): readonly RecentSearch[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentSearch[] = [];
    parsed.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const r = item as Record<string, unknown>;
      const text = typeof r.text === 'string' ? r.text.slice(0, 120) : '';
      const key = typeof r.key === 'string' ? r.key.slice(0, 120) : searchKey(text);
      const atMs = typeof r.atMs === 'number' && Number.isFinite(r.atMs) ? r.atMs : 0;
      if (text && key) out.push(Object.freeze({ text, key, atMs }));
    });
    return Object.freeze(out.slice(0, MAX_RECENT_SEARCHES));
  } catch {
    // Bozuk kayıt fail-soft atılır; yarısına güvenilmez.
    return [];
  }
}

export function getRecentSearches(): readonly RecentSearch[] {
  if (cache !== null) return cache;
  // `StateStorage.getItem` imzası Promise de dönebilir; bu depo SENKRONDUR ve
  // asenkron bir değer gelirse kayıt YOK sayılır (uydurma geçmiş üretilmez).
  const raw = safeStorage.getItem(STORAGE_KEY);
  cache = typeof raw === 'string' || raw === null ? parse(raw) : [];
  return cache;
}

/** Yalnız GERÇEKTEN yapılmış bir arama kaydedilir (her tuş vuruşu değil). */
export function rememberSearch(text: string, nowMs = Date.now()): readonly RecentSearch[] {
  const trimmed = (text ?? '').trim().slice(0, 120);
  const key = searchKey(trimmed);
  if (!key) return getRecentSearches();

  const existing = getRecentSearches().filter((r) => r.key !== key);
  const next = Object.freeze([
    Object.freeze({ text: trimmed, key, atMs: nowMs }),
    ...existing,
  ].slice(0, MAX_RECENT_SEARCHES));
  cache = next;
  try { safeStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* fail-soft */ }
  return next;
}

/** Kullanıcının açık isteğiyle tek kayıt silinir. */
export function forgetSearch(key: string): readonly RecentSearch[] {
  const next = Object.freeze(getRecentSearches().filter((r) => r.key !== key));
  cache = next;
  try { safeStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* fail-soft */ }
  return next;
}

/** Tümünü temizle — açık kullanıcı eylemi. */
export function clearRecentSearches(): void {
  cache = Object.freeze([]);
  try { safeStorage.removeItem(STORAGE_KEY); } catch { /* fail-soft */ }
}

export function _resetRecentSearchesForTest(): void { cache = null; }
