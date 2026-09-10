/**
 * savedLocationsService.ts — "Özel Konumlar" (saved locations) TEK OTORİTE.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Kayıtlı konum verisi ZATEN vardı: `useStore().settings.customLocations`
 * (Zustand, `updateSettings` ile persist edilir — `NavigationHUD.tsx`
 * `QuickDestinations` bunu doğrudan array mutasyonuyla okuyup yazıyordu).
 * Bu dosya YENİ BİR STORE KURMAZ — o kanonik veriye TEK giriş kapısı açar:
 * CRUD + isim çözümleme + paylaşım metni burada birleşir ki UI ve Mavi AYNI
 * kayıtları, AYNI ID'yle, AYNI kurala göre okusun/yazsın (CLAUDE.md §6).
 *
 * ── SAHİPLİK ─────────────────────────────────────────────────────────────
 *  · Kalıcılık: `useStore().updateSettings` (mevcut, değişmedi — korelasyon
 *    kanıtı zaten orada).
 *  · Alan adları: `id/lat/lng/name/timestamp` KORUNDU (yeniden adlandırmak
 *    persist edilmiş kullanıcı verisini/legacy okuyucuları kırardı).
 *  · İsim normalizasyonu: PARALEL bir normalize YOK — `companionIdentity`nin
 *    Türkçe-doğru `normalizeWakeText`i yeniden kullanılır.
 *  · Paylaşım: yeni bir paylaşım altyapısı KURULMADI — Web Share API
 *    (`navigator.share`, WebView'de gerçek native paylaşım sayfasını açar)
 *    birincil, mevcut `copyTextFailSoft` (native Clipboard → async → legacy
 *    execCommand) ZORUNLU yedek. Sessiz "başarılı" YASAK — ikisi de
 *    başarısız olursa dürüst `failed` döner.
 */

import { useStore } from '../../store/useStore';
import { normalizeWakeText } from '../companion/companionIdentity';
import { copyTextFailSoft } from '../devtools/carosLabClipboard';

export interface SavedLocation {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly name: string;
  readonly timestamp: number;
}

const MAX_SAVED_LOCATIONS = 20;

/* Kimlik çakışması KANITLANDI: `loc-${Date.now()}` aynı milisaniyede iki kayıt
 * (ör. arka arkaya iki "Burayı kaydet") AYNI ID'yi üretiyordu — silme filtresi
 * o zaman İKİSİNİ BİRDEN kaldırırdı. Sayaç eki kimliği tekilleştirir. */
let _idSeq = 0;

/** Kayıtlı konumlar — güncel liste, en yeni önde (mevcut UI sırası korunur). */
export function getSavedLocations(): readonly SavedLocation[] {
  return useStore.getState().settings.customLocations ?? [];
}

/**
 * Yeni konum kaydeder. GPS KANITI olmadan kayıt OLUŞTURULMAZ (fail-closed) —
 * tahmini/son-bilinen konum burada UYDURULMAZ; çağıran taze bir fix vermeli.
 *
 * `name` boşsa/verilmezse mevcut fallback korunur: "Konum N" (N = o anki
 * kayıt sayısı + 1) — eski isimsiz akışla BİREBİR aynı davranış.
 */
export function addSavedLocation(
  lat: number, lng: number, name?: string | null,
): SavedLocation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { customLocations, updateSettings } = _ctx();
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const finalName = trimmed.length > 0 ? trimmed.slice(0, 60) : `Konum ${customLocations.length + 1}`;
  const ts = Date.now();
  const entry: SavedLocation = {
    id: `loc-${ts}-${++_idSeq}`, lat, lng, name: finalName, timestamp: ts,
  };
  const next = [entry, ...customLocations].slice(0, MAX_SAVED_LOCATIONS);
  updateSettings({ customLocations: next });
  return entry;
}

/** Aynı ID üzerinde adı değiştirir (sil-yeniden-oluştur YOK — id/lat/lng/timestamp korunur). */
export function renameSavedLocation(id: string, newName: string): boolean {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const { customLocations, updateSettings } = _ctx();
  const idx = customLocations.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  const next = customLocations.slice();
  next[idx] = { ...next[idx], name: trimmed.slice(0, 60) };
  updateSettings({ customLocations: next });
  return true;
}

/** Kaydı siler. Yıkıcıdır — çağıran (Mavi) kendi onay akışını UYGULAMALIDIR. */
export function removeSavedLocation(id: string): boolean {
  const { customLocations, updateSettings } = _ctx();
  const next = customLocations.filter((l) => l.id !== id);
  if (next.length === customLocations.length) return false;
  updateSettings({ customLocations: next });
  return true;
}

function _ctx(): { customLocations: SavedLocation[]; updateSettings: (p: { customLocations: SavedLocation[] }) => void } {
  const s = useStore.getState();
  return { customLocations: [...(s.settings.customLocations ?? [])], updateSettings: s.updateSettings };
}

/* ══════════════════════════════════════════════════════════════════════════
 * İSİM ÇÖZÜMLEME — Mavi'nin "git / paylaş / adını değiştir / sil" komutlarının
 * TEK giriş noktası. Rastgele seçim YOK: belirsizlikte `ambiguous` doldurulur,
 * çağıran kullanıcıya sormalıdır (CLAUDE.md §11 fail-closed).
 * ════════════════════════════════════════════════════════════════════════ */

export interface LocationNameResolution {
  /** Tam olarak TEK aday varsa dolu. */
  readonly match: SavedLocation | null;
  /** Birden fazla aday eşleştiyse (rastgele seçim YASAK) — kullanıcıya sorulmalı. */
  readonly ambiguous: readonly SavedLocation[];
}

/**
 * Türkçe büyük/küçük harf + baş/son boşluk + noktalama farkına dayanıklı
 * eşleştirme. Sıra: TAM normalize eşleşme (varsa TEK adaysa kabul) → yoksa
 * "içerir" eşleşmeleri topla (birden fazlaysa ambiguous, TEK ise kabul).
 * `normalizeWakeText` companionIdentity'nin KENDİ normalizer'ıdır — paralel
 * normalize YOK.
 */
export function findSavedLocationByName(rawName: string): LocationNameResolution {
  const q = normalizeWakeText(rawName);
  if (!q) return { match: null, ambiguous: [] };
  const all = getSavedLocations();

  const exact = all.filter((l) => normalizeWakeText(l.name) === q);
  if (exact.length === 1) return { match: exact[0], ambiguous: [] };
  if (exact.length > 1) return { match: null, ambiguous: exact };

  const contains = all.filter((l) => {
    const n = normalizeWakeText(l.name);
    return n.includes(q) || q.includes(n);
  });
  if (contains.length === 1) return { match: contains[0], ambiguous: [] };
  if (contains.length > 1) return { match: null, ambiguous: contains };

  return { match: null, ambiguous: [] };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PAYLAŞIM — UI ve Mavi AYNI metni, AYNI yolu kullanır.
 * ════════════════════════════════════════════════════════════════════════ */

/** Yaygın harita uygulamalarının açabileceği HTTPS konum bağlantısı. */
export function buildLocationMapsUrl(loc: Pick<SavedLocation, 'lat' | 'lng'>): string {
  return `https://www.google.com/maps?q=${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
}

/** Paylaşılacak anlaşılır metin: ad + koordinat + HTTPS bağlantı. */
export function buildLocationShareText(loc: SavedLocation): string {
  return `${loc.name}\n${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}\n${buildLocationMapsUrl(loc)}`;
}

export type ShareRoute = 'native' | 'clipboard' | 'failed';

/**
 * Paylaşır. Sıra: Web Share API (`navigator.share` — WebView'de GERÇEK native
 * paylaşım sayfasını açar; yeni bir Capacitor eklentisi GETİRİLMEDİ) →
 * başarısız/yoksa mevcut `copyTextFailSoft` (pano, üç kademeli). Kullanıcı
 * paylaşım sayfasını İPTAL ederse (`AbortError`) bu BAŞARISIZLIK SAYILMAZ —
 * kullanıcı bilinçli vazgeçti, panoya sessizce düşmek CANINI SIKARDI.
 * Gerçek hata/yoksunlukta ASLA sessiz "başarılı" DÖNMEZ.
 */
export async function shareSavedLocation(loc: SavedLocation): Promise<{ ok: boolean; route: ShareRoute }> {
  const text = buildLocationShareText(loc);
  const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { share?: (d: ShareData) => Promise<void> } : null;
  if (nav?.share) {
    try {
      await nav.share({ title: loc.name, text, url: buildLocationMapsUrl(loc) });
      return { ok: true, route: 'native' };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { ok: true, route: 'native' };
      /* düş — panoya dene */
    }
  }
  const route = await copyTextFailSoft(text);
  return { ok: route !== 'failed', route: route === 'failed' ? 'failed' : 'clipboard' };
}

/** @internal — testler arası izolasyon yardımcısı yok; store zaten `_resetStoreForTest` ile sıfırlanır. */
