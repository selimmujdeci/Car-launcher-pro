/**
 * recentlyPlayed.ts — F5.1 · Sınırlı yerel "son çalınanlar" PROJEKSİYONU.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · **Playback truth DEĞİLDİR.** Buradaki kayıt "çalındı" değil, "çalma
 *     BAŞLATILDI" kanıtıdır; sesin gerçekten çıktığı F0 otoritesindedir.
 *   · **Öneri otoritesi DEĞİLDİR.** Sıralamaya, keşfe veya sesli seçime
 *     girmez; yalnız kullanıcının kendi geçmişini görmesini sağlar.
 *   · **Gizlilik:** başlık · sanatçı · albüm · URI SAKLANMAZ. Yalnız kanonik
 *     kimlik (yerel `trackId` veya sağlayıcı kimliği), kaynak ve zaman tutulur.
 *     Gösterim anında kanonik kütüphaneden çözülür; çözülemeyen satır GÖSTERİLMEZ.
 *   · Sabit üst sınır — sınırsız büyüme yok. Yeni analitik sistemi kurulmaz.
 */
import { safeStorage } from '../../../utils/safeStorage';
import type { ProviderId } from '../providers';

export const MAX_RECENTLY_PLAYED = 12;
const STORAGE_KEY = 'caros.music.recentlyPlayed.v1';

export interface RecentlyPlayedEntry {
  /** Yerel kütüphane parçası ise `musicIndex` kimliği; sağlayıcıda `null`. */
  readonly libraryTrackId: string | null;
  /** Sağlayıcı sonucunun kararlı kimliği; yerelde `null`. */
  readonly providerRef: string | null;
  readonly providerId: ProviderId;
  readonly atMs: number;
}

let cache: readonly RecentlyPlayedEntry[] | null = null;

function parse(raw: unknown): readonly RecentlyPlayedEntry[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentlyPlayedEntry[] = [];
    parsed.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const r = item as Record<string, unknown>;
      const libraryTrackId = typeof r.libraryTrackId === 'string' ? r.libraryTrackId.slice(0, 200) : null;
      const providerRef = typeof r.providerRef === 'string' ? r.providerRef.slice(0, 200) : null;
      const providerId = typeof r.providerId === 'string' ? r.providerId as ProviderId : null;
      const atMs = typeof r.atMs === 'number' && Number.isFinite(r.atMs) ? r.atMs : 0;
      // Kimliksiz kayıt bir kanıt taşımaz — atılır.
      if (providerId && (libraryTrackId || providerRef)) {
        out.push(Object.freeze({ libraryTrackId, providerRef, providerId, atMs }));
      }
    });
    return Object.freeze(out.slice(0, MAX_RECENTLY_PLAYED));
  } catch {
    return [];   // bozuk kayıt fail-soft atılır; yarısına güvenilmez
  }
}

export function getRecentlyPlayed(): readonly RecentlyPlayedEntry[] {
  if (cache !== null) return cache;
  const raw = safeStorage.getItem(STORAGE_KEY);
  cache = typeof raw === 'string' || raw === null ? parse(raw) : [];
  return cache;
}

/**
 * Çalma BAŞLATILDIĞINDA kaydeder. Aynı öğe tekrar başlatılırsa listede
 * yukarı taşınır, ikinci kez EKLENMEZ.
 */
export function rememberPlayed(
  input: Omit<RecentlyPlayedEntry, 'atMs'>, nowMs = Date.now(),
): readonly RecentlyPlayedEntry[] {
  if (!input.libraryTrackId && !input.providerRef) return getRecentlyPlayed();
  const key = input.libraryTrackId ?? input.providerRef;
  const existing = getRecentlyPlayed().filter(
    (e) => (e.libraryTrackId ?? e.providerRef) !== key,
  );
  const next = Object.freeze([
    Object.freeze({ ...input, atMs: nowMs }),
    ...existing,
  ].slice(0, MAX_RECENTLY_PLAYED));
  cache = next;
  try { safeStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* fail-soft */ }
  return next;
}

/** Kullanıcının açık isteğiyle temizlenir. */
export function clearRecentlyPlayed(): void {
  cache = Object.freeze([]);
  try { safeStorage.removeItem(STORAGE_KEY); } catch { /* fail-soft */ }
}

export function _resetRecentlyPlayedForTest(): void { cache = null; }
