/**
 * preferenceEvidence.ts — MUSIC F8 · Sınırlı YEREL dinleme tercihi kanıtı.
 *
 * NE TUTAR: "bu bağlamda (kova) kullanıcı hangi dinleme NİYETİNİ seçti ve
 * onu KORUDU mu" — yalnız sayaç.
 *
 * GİZLİLİK — PAZARLIKSIZ (CLAUDE.md gözlemlenebilirlik kuralı 6):
 *   · Parça/albüm/sanatçı ADI, URI, kapak, arama sorgusu, konuşma içeriği
 *     BURAYA YAZILMAZ.
 *   · Konum · koordinat · rota · hedef · VIN YAZILMAZ.
 *   · Sağlayıcı içeriğinin kimliği (video id, uri) YAZILMAZ — sağlayıcı
 *     tarafında yalnız KAYNAK SINIFI (`YOUTUBE` · `INTERNET_RADIO` …) tutulur.
 *   · Kütüphane referansı yalnız CİHAZ-YEREL `musicIndex` kimliğidir; gösterim
 *     anında çözülür, çözülemezse satır KULLANILMAZ.
 *
 * SINIRLI: sabit üst sınır (LRU) + TTL. Sınırsız büyüyen bir profil YOKTUR.
 * Kullanıcı silebilir (`clearPreferenceEvidence`).
 *
 * OTORİTE SINIRI: bu bir öneri MOTORU değildir — yalnız KANIT deposudur.
 * Karar `musicIntelligenceModel` (saf) tarafından verilir.
 */

import { safeStorage } from '../../../utils/safeStorage';
import type { ListeningIntent } from '../session/listeningSession';
import type { SourceClass } from '../authority/sourceCapabilities';

export const PREFERENCE_STORAGE_KEY = 'caros.music.f8.preference.v1';
/** Sabit üst sınır — kova × niyet kombinasyonu için fazlasıyla yeter. */
export const MAX_PREFERENCE_ENTRIES = 48;
/** Bu yaştan eski kanıt kullanılmaz (45 gün) — eski alışkanlık bugünü yönetmez. */
export const PREFERENCE_TTL_MS = 45 * 24 * 60 * 60 * 1000;
/** Bir oturumun "korundu" sayılması için gereken en az süre. */
export const KEPT_MIN_DWELL_MS = 90_000;

export type PreferenceOutcome = 'STARTED' | 'KEPT' | 'ABANDONED';

export interface PreferenceEntry {
  /** `${bucket}|${intent}|${ref}` — tek anahtar, tek satır. */
  readonly key: string;
  readonly bucket: string;
  readonly intent: ListeningIntent;
  /**
   * Kütüphane niyetinin kanonik referansı (albüm/sanatçı/klasör kimliği).
   * Sağlayıcı kökenli niyette `null`'dır ve yerine `sourceClass` taşınır —
   * sağlayıcı İÇERİK kimliği burada TUTULMAZ.
   */
  readonly libraryRef: string | null;
  readonly sourceClass: SourceClass;
  readonly starts: number;
  readonly kept: number;
  readonly abandoned: number;
  readonly lastAtMs: number;
}

export interface PreferenceSnapshot {
  readonly entries: readonly PreferenceEntry[];
  /** Her yazımda artar — projeksiyon önbelleklerinin anahtarı. */
  readonly revision: number;
}

let entries: readonly PreferenceEntry[] | null = null;
let revision = 0;

const clampCount = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.trunc(v), 9999) : 0;

function parse(raw: unknown): readonly PreferenceEntry[] {
  if (typeof raw !== 'string' || raw.length === 0) return Object.freeze([]);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Object.freeze([]);
    const out: PreferenceEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const key = typeof r.key === 'string' ? r.key.slice(0, 160) : null;
      const bucket = typeof r.bucket === 'string' ? r.bucket.slice(0, 40) : null;
      const intent = typeof r.intent === 'string' ? r.intent as ListeningIntent : null;
      const sourceClass = typeof r.sourceClass === 'string' ? r.sourceClass as SourceClass : null;
      const lastAtMs = typeof r.lastAtMs === 'number' && Number.isFinite(r.lastAtMs) ? r.lastAtMs : 0;
      if (!key || !bucket || !intent || !sourceClass || lastAtMs <= 0) continue;
      out.push(Object.freeze({
        key,
        bucket,
        intent,
        libraryRef: typeof r.libraryRef === 'string' ? r.libraryRef.slice(0, 200) : null,
        sourceClass,
        starts: clampCount(r.starts),
        kept: clampCount(r.kept),
        abandoned: clampCount(r.abandoned),
        lastAtMs,
      }));
    }
    return Object.freeze(out.slice(0, MAX_PREFERENCE_ENTRIES));
  } catch {
    return Object.freeze([]);   // bozuk kayıt fail-soft atılır; yarısına güvenilmez
  }
}

function load(): readonly PreferenceEntry[] {
  if (entries !== null) return entries;
  let raw: unknown = null;
  try { raw = safeStorage.getItem(PREFERENCE_STORAGE_KEY); } catch { raw = null; }
  entries = parse(raw);
  return entries;
}

function persist(next: readonly PreferenceEntry[]): void {
  entries = next;
  revision += 1;
  try {
    safeStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(next));
  } catch { /* fail-soft: kanıt yazılamazsa öneri zayıflar, ürün ÇALIŞMAYA devam eder */ }
}

/** Kanıt anahtarı — sağlayıcı içerik kimliği ASLA anahtarın parçası olmaz. */
export function preferenceKey(
  bucket: string, intent: ListeningIntent, libraryRef: string | null, sourceClass: SourceClass,
): string {
  return `${bucket}|${intent}|${libraryRef ?? sourceClass}`;
}

export interface PreferenceObservation {
  readonly bucket: string;
  readonly intent: ListeningIntent;
  readonly libraryRef: string | null;
  readonly sourceClass: SourceClass;
  readonly outcome: PreferenceOutcome;
  readonly nowMs: number;
}

/**
 * Kanıt yazar.
 *
 * `UNKNOWN` kovaya YAZILMAZ: bağlamı bilinmeyen bir dinleme, sonradan hangi
 * bağlamda önerileceği bilinmeyen bir kanıt üretirdi.
 */
export function notePreferenceOutcome(o: PreferenceObservation): PreferenceSnapshot {
  if (o.bucket === 'UNKNOWN' || o.bucket.length === 0) return getPreferenceEvidence(o.nowMs);
  if (!Number.isFinite(o.nowMs) || o.nowMs <= 0) return getPreferenceEvidence();

  const key = preferenceKey(o.bucket, o.intent, o.libraryRef, o.sourceClass);
  const current = load();
  const existing = current.find((e) => e.key === key) ?? null;

  const updated: PreferenceEntry = Object.freeze({
    key,
    bucket: o.bucket,
    intent: o.intent,
    libraryRef: o.libraryRef,
    sourceClass: o.sourceClass,
    starts: (existing?.starts ?? 0) + (o.outcome === 'STARTED' ? 1 : 0),
    kept: (existing?.kept ?? 0) + (o.outcome === 'KEPT' ? 1 : 0),
    abandoned: (existing?.abandoned ?? 0) + (o.outcome === 'ABANDONED' ? 1 : 0),
    lastAtMs: o.nowMs,
  });

  /* LRU: en eski dokunulan satır düşer — sınırsız profil YOKTUR. */
  const next = [updated, ...current.filter((e) => e.key !== key)]
    .sort((a, b) => b.lastAtMs - a.lastAtMs)
    .slice(0, MAX_PREFERENCE_ENTRIES);

  persist(Object.freeze(next));
  return Object.freeze({ entries: entries ?? Object.freeze([]), revision });
}

/** Canlı kanıt — TTL'i geçmiş satırlar DÖNDÜRÜLMEZ (eski alışkanlık dayatılmaz). */
export function getPreferenceEvidence(nowMs = Date.now()): PreferenceSnapshot {
  const all = load();
  const fresh = all.filter((e) => nowMs - e.lastAtMs <= PREFERENCE_TTL_MS);
  return Object.freeze({ entries: Object.freeze(fresh), revision });
}

/**
 * Bu kovadaki en güçlü aday.
 *
 * SKOR: `kept - abandoned`. "Başlatıldı" TEK BAŞINA tercih kanıtı DEĞİLDİR —
 * kullanıcı bir şeyi açıp hemen kapattıysa o bir tercih değil, bir HATADIR.
 * En az bir KORUNMUŞ dinleme şarttır; eşitlikte en YENİ kazanır.
 */
export function bestPreferenceFor(
  bucket: string, snapshot: PreferenceSnapshot,
): PreferenceEntry | null {
  if (bucket === 'UNKNOWN' || bucket.length === 0) return null;
  let best: PreferenceEntry | null = null;
  let bestScore = 0;
  for (const e of snapshot.entries) {
    if (e.bucket !== bucket) continue;
    if (e.kept <= 0) continue;                 // kanıtsız aday önerilmez
    const score = e.kept - e.abandoned;
    if (score <= 0) continue;
    if (best === null || score > bestScore
      || (score === bestScore && e.lastAtMs > best.lastAtMs)) {
      best = e; bestScore = score;
    }
  }
  return best;
}

/** Kullanıcının açık isteğiyle temizlenir — tek düğmeyle tüm F8 kanıtı gider. */
export function clearPreferenceEvidence(): void {
  entries = Object.freeze([]);
  revision += 1;
  try { safeStorage.removeItem(PREFERENCE_STORAGE_KEY); } catch { /* fail-soft */ }
}

export function _resetPreferenceEvidenceForTest(): void {
  entries = null;
  revision = 0;
}
