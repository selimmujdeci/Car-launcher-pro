/**
 * companionStore.ts — Companion YEREL kalıcılığı (P1-PREP).
 *
 * ── SINIRLAR (pazarlıksız) ──────────────────────────────────────────────────
 *  · YALNIZ YEREL. Production backend · Supabase · Firebase · uzak sunucu ·
 *    telemetri servisi — HİÇBİRİNE gönderim YOK (bu dosyada ağ çağrısı bulunmaz).
 *  · Mevcut `safeStorage` sarmalayıcısı kullanılır (kota/bozulma dayanıklı) —
 *    yeni depolama deseni İCAT EDİLMEZ.
 *  · Anahtarlar `caros.companion.*` ad alanında → üretim kullanıcı verisiyle
 *    KARIŞMAZ.
 *  · Okuma ASLA throw etmez; bozuk/eski gövde göç eder, anlaşılamazsa null döner.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Diske YALNIZ şunlar yazılır: oturum iskeleti (kimlik/damga/durum/nesil),
 * yetenek JETONLARI, geri çevrilemez `peerKeyHash`, sayısal telemetri.
 * Cihaz adı · MAC · telefon numarası · kişi · mesaj içeriği · payload
 * YAZILMAZ — yazma yolunda ayrıca bir deny-key süzgeci vardır.
 *
 * Bu dosya I/O yaptığı için SAF DEĞİLDİR; saf mantık diğer companion dosyalarında.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import { COMPANION_SCHEMA_VERSION, type CapabilityToken } from './companionDomain';
import { migratePhoneHubSession, type PhoneHubSession } from './companionSession';
import { migrateKnownDevices, type KnownDeviceRecord } from './pairingModel';
import type { CompanionTelemetrySnapshot } from './companionTelemetry';

/* ══════════════════════════════════════════════════════════════════════════
 * Anahtarlar
 * ════════════════════════════════════════════════════════════════════════ */

export const COMPANION_KEY_SESSION   = 'caros.companion.session.v1';
export const COMPANION_KEY_DEVICES   = 'caros.companion.knownDevices.v1';
export const COMPANION_KEY_CAPS      = 'caros.companion.capabilityCache.v1';
export const COMPANION_KEY_TELEMETRY = 'caros.companion.telemetry.v1';

export const COMPANION_STORAGE_KEYS: readonly string[] = Object.freeze([
  COMPANION_KEY_SESSION, COMPANION_KEY_DEVICES, COMPANION_KEY_CAPS, COMPANION_KEY_TELEMETRY,
]);

/* ══════════════════════════════════════════════════════════════════════════
 * PII süzgeci (yazma yolunda ikinci kapı)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Diske YAZILMASI YASAK anahtar parçaları. Model tipleri bunları zaten
 * taşımıyor; bu süzgeç ileride bir alan eklenirse SESSİZCE sızmasını engeller.
 */
const DENY_KEY_FRAGMENTS: readonly string[] = Object.freeze([
  'mac', 'address', 'phone', 'number', 'contact', 'displayname', 'devicename',
  'title', 'artist', 'album', 'artwork', 'body', 'text', 'message', 'notification',
  'token', 'secret', 'password', 'bearer', 'payload', 'imei', 'serial', 'androidid',
  'lat', 'lon', 'coord', 'vin', 'plate',
]);

/** İzin verilen açık liste — deny parçalarıyla çakışan MEŞRU alanlar. */
const ALLOW_KEYS: ReadonlySet<string> = new Set<string>([
  'peerkeyhash', 'payloadtype', 'payloadversion', 'messagelatencymslast',
  'messagelatencymsmedian', 'messagelatencymsmax', 'messagelatencysamplecount',
]);

export function isDeniedStorageKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return true;
  const k = key.toLowerCase();
  if (ALLOW_KEYS.has(k)) return false;
  for (const frag of DENY_KEY_FRAGMENTS) if (k.includes(frag)) return true;
  return false;
}

/** Derinlik/uzunluk tavanlı, deny-key düşüren süzgeç. ASLA throw etmez. */
export function sanitizeForStorage(v: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 240 ? v.slice(0, 240) : v;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length && i < 128; i++) out.push(sanitizeForStorage(v[i], depth + 1));
    return out;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (isDeniedStorageKey(k)) continue;
      out[k] = sanitizeForStorage(val, depth + 1);
    }
    return out;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ortak yazma/okuma
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ANINDA yazım (debounce değil).
 *
 * Gerekçe: bu kayıtlar yüksek frekanslı telemetri DEĞİLDİR — oturum yaşam
 * döngüsü olaylarında yazılır. Buna karşılık kaybı pahalıdır (güven kaydı,
 * saha kanıtı). eMMC bütçesi (CLAUDE.md §I/O) yüksek frekanslı yazımlar içindir.
 * Ek fayda: okuma-yazma tutarlılığı anındadır (testler deterministik).
 */
function _write(key: string, value: unknown): boolean {
  try {
    safeSetRaw(key, JSON.stringify(sanitizeForStorage(value)), 0, true);
    return true;
  } catch {
    return false;
  }
}

function _read(key: string): unknown {
  let raw: string | null;
  try { raw = safeGetRaw(key); } catch { return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Oturum
 * ════════════════════════════════════════════════════════════════════════ */

export function saveCompanionSession(session: PhoneHubSession | null): boolean {
  if (session === null) return _write(COMPANION_KEY_SESSION, null);
  return _write(COMPANION_KEY_SESSION, session);
}

/**
 * Kalıcı oturumu okur.
 *
 * KRİTİK: durum "BAĞLI" olarak GERİ YÜKLENMEZ — bu iş `demoteRestoredSession`'ın
 * sorumluluğudur ve Session Manager tarafından uygulanır. Bu fonksiyon ham
 * kaydı döndürür ki çağıran bilinçli olarak indirgesin.
 */
export function loadCompanionSession(): PhoneHubSession | null {
  return migratePhoneHubSession(_read(COMPANION_KEY_SESSION));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bilinen cihazlar (eşleştirme güven kaydı)
 * ════════════════════════════════════════════════════════════════════════ */

export function saveKnownDevices(list: readonly KnownDeviceRecord[]): boolean {
  return _write(COMPANION_KEY_DEVICES, Array.isArray(list) ? list : []);
}

export function loadKnownDevices(): readonly KnownDeviceRecord[] {
  return migrateKnownDevices(_read(COMPANION_KEY_DEVICES));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yetenek önbelleği
 * ════════════════════════════════════════════════════════════════════════ */

export interface CapabilityCacheEntry {
  readonly peerKeyHash: string;
  readonly tokens: readonly CapabilityToken[];
  readonly digest: string;
  readonly updatedAt: number;
}

export function saveCapabilityCache(entries: readonly CapabilityCacheEntry[]): boolean {
  return _write(COMPANION_KEY_CAPS, Array.isArray(entries) ? entries.slice(0, 8) : []);
}

/**
 * Yetenek önbelleğini okur.
 *
 * DÜRÜSTLÜK: önbellek YALNIZ bir İPUCUDUR (UI'ı önceden doldurmak için).
 * Anlaşma yapılmadan bu jetonlar `granted` SAYILMAZ — aksi hâlde karşı taraf
 * bir yeteneği kaybettiğinde sahte yetenek gösterilirdi.
 */
export function loadCapabilityCache(): readonly CapabilityCacheEntry[] {
  const v = _read(COMPANION_KEY_CAPS);
  const out: CapabilityCacheEntry[] = [];
  if (!Array.isArray(v)) return Object.freeze(out);
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.peerKeyHash !== 'string' || o.peerKeyHash.length === 0) continue;
    const tokens: CapabilityToken[] = [];
    if (Array.isArray(o.tokens)) {
      for (const t of o.tokens) {
        if (typeof t === 'string' && t.length > 0 && tokens.length < 64) tokens.push(t.slice(0, 48));
      }
    }
    out.push({
      peerKeyHash: o.peerKeyHash.slice(0, 16),
      tokens: Object.freeze(tokens.sort()),
      digest: typeof o.digest === 'string' ? o.digest.slice(0, 240) : '',
      updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)
        ? Math.trunc(o.updatedAt) : 0,
    });
    if (out.length >= 8) break;
  }
  return Object.freeze(out);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Telemetri
 * ════════════════════════════════════════════════════════════════════════ */

export function saveCompanionTelemetry(snap: CompanionTelemetrySnapshot): boolean {
  return _write(COMPANION_KEY_TELEMETRY, { schemaVersion: COMPANION_SCHEMA_VERSION, ...snap });
}

export function loadCompanionTelemetryRaw(): unknown {
  return _read(COMPANION_KEY_TELEMETRY);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bakım
 * ════════════════════════════════════════════════════════════════════════ */

/** Tüm companion kayıtlarını siler. Sistem/Bluetooth durumuna DOKUNMAZ. */
export function clearCompanionStorage(): boolean {
  let ok = true;
  for (const key of COMPANION_STORAGE_KEYS) {
    try { safeRemoveRaw(key); } catch { ok = false; }
  }
  return ok;
}

export interface CompanionStorageHealth {
  readonly sessionPresent: boolean;
  readonly knownDeviceCount: number;
  readonly capabilityCacheCount: number;
  readonly telemetryPresent: boolean;
  readonly schemaVersion: number;
}

/** Kalıcı katmanın salt-okunur sağlık özeti (LAB ekranı için). */
export function companionStorageHealth(): CompanionStorageHealth {
  return {
    sessionPresent: loadCompanionSession() !== null,
    knownDeviceCount: loadKnownDevices().length,
    capabilityCacheCount: loadCapabilityCache().length,
    telemetryPresent: loadCompanionTelemetryRaw() !== null,
    schemaVersion: COMPANION_SCHEMA_VERSION,
  };
}
