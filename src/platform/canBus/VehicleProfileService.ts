/**
 * VehicleProfileService.ts — Patch 2
 *
 * Sorumluluklar:
 *   1. /canProfiles/_index.json oku → profil listesi
 *   2. İlgili JSON profilini fetch et
 *   3. Runtime schema validate et — bozuk JSON uygulamayı çökertemez
 *   4. Son geçerli profili SafeStorage'a yaz (cache)
 *   5. Hata → standard_obd fallback, sebebi logla
 *
 * Yazma tarafına (CAN write/command) dokunmaz.
 * RawCanDecoder akışını bozmaz.
 * VehicleSignalResolver'a bağlanmaz — Patch 3'e ertelendi.
 */

import type { VehicleCanProfile, ProfileIndex, ProfileLoadResult, CanSignalDef, CanSignalName, SafetyLevel } from './canProfileTypes';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import { logError }               from '../crashLogger';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const CACHE_KEY        = 'car-can-profile-cache';
const INDEX_URL        = '/canProfiles/_index.json';
const BASE_URL         = '/canProfiles/';
const STANDARD_OBD_ID  = 'standard_obd';
const FETCH_TIMEOUT_MS = 5_000;

// ── Tipler ───────────────────────────────────────────────────────────────────

export type { ProfileLoadResult };

// ── Runtime schema doğrulama ─────────────────────────────────────────────────

const VALID_SIGNAL_NAMES: ReadonlySet<string> = new Set<CanSignalName>([
  'speed', 'rpm', 'reverse', 'fuel', 'coolant',
  'doorFl', 'doorFr', 'doorRl', 'doorRr',
  'headlights', 'parkingBrake', 'seatbelt',
  'throttle', 'oilTemp', 'battVolt',
]);

const VALID_SAFETY_LEVELS: ReadonlySet<string> = new Set<SafetyLevel>([
  'verified', 'community', 'experimental',
]);

const VALID_PROTOCOLS = new Set([
  'CAN11_500', 'CAN11_250', 'CAN29_500', 'CAN29_250', 'OBD2_AUTO', 'AUTO',
]);

function _validateSignal(s: unknown): s is CanSignalDef {
  if (!s || typeof s !== 'object') return false;
  const sig = s as Record<string, unknown>;
  if (!VALID_SIGNAL_NAMES.has(sig['name'] as string))   return false;
  if (typeof sig['canId']     !== 'number')             return false;
  if (typeof sig['startByte'] !== 'number')             return false;
  if (typeof sig['length']    !== 'number')             return false;
  if (typeof sig['scale']     !== 'number')             return false;
  if (typeof sig['offset']    !== 'number')             return false;
  if (typeof sig['unit']      !== 'string')             return false;
  if (sig['length'] < 1 || sig['length'] > 8)          return false;
  if (sig['startByte'] < 0)                            return false;
  return true;
}

/**
 * Bozuk JSON uygulamayı çökertemez.
 * Alan kontrolleri minimum ama yeterli — false-positive reddi önlenir.
 */
function _validateProfile(obj: unknown, id: string): obj is VehicleCanProfile {
  if (!obj || typeof obj !== 'object') {
    _log(`[validate] ${id}: nesne değil`);
    return false;
  }
  const p = obj as Record<string, unknown>;

  if (typeof p['id']               !== 'string')  { _log(`[validate] ${id}: id eksik`);               return false; }
  if (typeof p['version']          !== 'string')  { _log(`[validate] ${id}: version eksik`);           return false; }
  if (typeof p['make']             !== 'string')  { _log(`[validate] ${id}: make eksik`);              return false; }
  if (typeof p['model']            !== 'string')  { _log(`[validate] ${id}: model eksik`);             return false; }
  if (typeof p['yearFrom']         !== 'number')  { _log(`[validate] ${id}: yearFrom eksik`);          return false; }
  if (typeof p['yearTo']           !== 'number')  { _log(`[validate] ${id}: yearTo eksik`);            return false; }
  if (!VALID_PROTOCOLS.has(p['protocol'] as string)) { _log(`[validate] ${id}: geçersiz protocol`);   return false; }
  if (typeof p['confidenceScore']  !== 'number' ||
      p['confidenceScore'] < 0 || p['confidenceScore'] > 1) {
    _log(`[validate] ${id}: confidenceScore aralık dışı`);
    return false;
  }
  if (!VALID_SAFETY_LEVELS.has(p['safetyLevel'] as string)) {
    _log(`[validate] ${id}: geçersiz safetyLevel`);
    return false;
  }
  if (!Array.isArray(p['signals'])) {
    _log(`[validate] ${id}: signals dizi değil`);
    return false;
  }

  // Sinyal listesi boş olabilir (standard_obd gibi) — her biri kontrol edilir
  for (let i = 0; i < (p['signals'] as unknown[]).length; i++) {
    if (!_validateSignal((p['signals'] as unknown[])[i])) {
      _log(`[validate] ${id}: signals[${i}] geçersiz`);
      return false;
    }
  }

  return true;
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _log(msg: string): void {
  if (import.meta.env.DEV) console.log(`[VehicleProfileService] ${msg}`);
}

/** Timeout'lu fetch — yavaş/erişilemeyen varlıklar uygulamayı bloke etmez */
async function _fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

/** URL'den JSON yükle — ağ/parse hatası fırlatabilir */
async function _fetchJson(url: string): Promise<unknown> {
  const res = await _fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function _cacheWrite(profile: VehicleCanProfile): void {
  try {
    safeSetRaw(CACHE_KEY, JSON.stringify(profile));
  } catch (e) {
    logError('VehicleProfileService:cacheWrite', e);
  }
}

function _cacheRead(): VehicleCanProfile | null {
  try {
    const raw = safeGetRaw(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as unknown;
    if (_validateProfile(obj, 'cache')) return obj;
    _log('Cache geçersiz — yok sayıldı');
    return null;
  } catch {
    return null;
  }
}

// ── Standard OBD fallback yükleyici ──────────────────────────────────────────

async function _loadStandardObd(): Promise<VehicleCanProfile> {
  try {
    const obj = await _fetchJson(`${BASE_URL}${STANDARD_OBD_ID}.json`);
    if (_validateProfile(obj, STANDARD_OBD_ID)) return obj;
    throw new Error('standard_obd.json geçersiz schema');
  } catch (e) {
    logError('VehicleProfileService:loadStandardObd', e);
    // En son çare: inline minimum profil — fetch bile başarısız olsa uygulama düşmez
    return {
      id: STANDARD_OBD_ID, version: '1.0.0',
      make: '*', model: '*', yearFrom: 1996, yearTo: 9999,
      protocol: 'OBD2_AUTO', confidenceScore: 1.0,
      safetyLevel: 'verified', fallbackProfile: null, signals: [],
    };
  }
}

// ── Ana yükleme mantığı ───────────────────────────────────────────────────────

/**
 * Profil ID'sine göre JSON yükle, validate et, cache'e yaz.
 * Herhangi bir adımda hata → standard_obd fallback.
 */
export async function loadProfileById(profileId: string): Promise<ProfileLoadResult> {
  // 1. Önce cache'i dene (offline veya hızlı yeniden başlatma)
  const cached = _cacheRead();
  if (cached && cached.id === profileId) {
    _log(`Cache hit: ${profileId}`);
    return { ok: true, profile: cached };
  }

  // 2. Index'ten dosya adını bul
  let fileName: string | undefined;
  try {
    const indexRaw = await _fetchJson(INDEX_URL);
    const index = indexRaw as ProfileIndex;
    const entry = index?.profiles?.find(p => p.id === profileId);
    fileName = entry?.file;
    if (!fileName) {
      _log(`Index'te bulunamadı: ${profileId} → standard_obd fallback`);
      return { ok: false, reason: `profil index'te yok: ${profileId}`, fallback: STANDARD_OBD_ID };
    }
  } catch (e) {
    logError('VehicleProfileService:fetchIndex', e);
    _log(`Index fetch hatası → standard_obd fallback`);
    const fallback = await _loadStandardObd();
    // Fallback profili cache'e yaz — sonraki açılışta tekrar fetch'e gerek yok
    _cacheWrite(fallback);
    return { ok: false, reason: `index okunamadı: ${String(e)}`, fallback: STANDARD_OBD_ID };
  }

  // 3. Profil JSON'unu yükle
  try {
    const obj = await _fetchJson(`${BASE_URL}${fileName}`);
    if (!_validateProfile(obj, profileId)) {
      throw new Error(`şema doğrulama başarısız: ${profileId}`);
    }
    _cacheWrite(obj);
    _log(`Yüklendi: ${profileId} v${obj.version}`);
    return { ok: true, profile: obj };
  } catch (e) {
    logError('VehicleProfileService:loadProfile', e);
    _log(`Profil yüklenemedi: ${String(e)} → standard_obd fallback`);
    const fallback = await _loadStandardObd();
    _cacheWrite(fallback);
    return { ok: false, reason: String(e), fallback: STANDARD_OBD_ID };
  }
}

/**
 * Profil listesini index'ten yükle.
 * UI'da araç seçimi için kullanılır (Patch 3).
 * Hata → boş liste, uygulama çökmez.
 */
export async function listAvailableProfiles(): Promise<ProfileIndex['profiles']> {
  try {
    const raw = await _fetchJson(INDEX_URL);
    return (raw as ProfileIndex).profiles ?? [];
  } catch (e) {
    logError('VehicleProfileService:listProfiles', e);
    return [];
  }
}

/**
 * SafeStorage cache'den son geçerli profili senkron oku.
 * Uygulama açılışında (async hazır olmadan önce) ilk render için.
 */
export function getCachedProfile(): VehicleCanProfile | null {
  return _cacheRead();
}

/**
 * Cache'i temizle — araç değiştirildiğinde veya profil bozulduğunda.
 */
export function clearProfileCache(): void {
  try {
    safeSetRaw(CACHE_KEY, '');
  } catch { /* ignore */ }
}
