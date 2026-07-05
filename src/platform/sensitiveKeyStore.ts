/**
 * sensitiveKeyStore — Android Keystore destekli güvenli anahtar deposu.
 *
 * Industrial-Grade Hardening:
 *   - Native platformda: CarLauncher.secureStoreSet/Get → EncryptedSharedPreferences
 *     → Android Keystore (hardware-backed AES-256-GCM, API 23+)
 *   - Web/tarayıcı modunda: Web Crypto API + AES-256-GCM fallback
 *     (localStorage — sadece geliştirme/demo amaçlı)
 *
 * Zero Static Secrets: APP_SECRET sabiti tamamen kaldırıldı.
 *   Şifreleme anahtarı JS katmanında YOKTUR. Native tarafta Android Keystore
 *   tarafından yönetilir; adb backup, root erişimi veya JS tarafından
 *   okunamaz.
 *
 * Migration: İlk çağrıda eski localStorage şifreli veriler native depoya taşınır.
 */

import { Capacitor } from '@capacitor/core';
import { logInfo } from './debug';
import { logError } from './crashLogger';
import { CarLauncher } from './nativePlugin';

export type SensitiveKey =
  | 'geminiApiKey'
  | 'claudeHaikuApiKey'
  | 'groqApiKey'
  | 'tavilyApiKey'          // Tavily web-arama anahtarı — Groq'a internet grounding sağlar
  | 'car-e2e-private-key'   // ECDH P-256 private key (JWK) — NativeCryptoManager alias'ı ile aynı (C4)
  | 'veh_device_id'
  | 'veh_api_key'
  | 'veh_vehicle_id'
  | 'geofence_center'
  | 'geofence_radius'
  | 'geofence_vale_active'
  | 'geofence_vale_limit'
  | 'geofence_zones'
  | 'geofence_enabled'
  | 'maint_inspection_date'
  | 'maint_oil_change_km'
  | 'maint_insurance_date'
  | 'nav_history';

// ── Native (Android Keystore) ─────────────────────────────────────────────

const _isNative = Capacitor.isNativePlatform();

/**
 * Reinstall/güncelleme sonrası API anahtarlarını kurtarmak için ikincil depo.
 * EncryptedSharedPreferences Keystore anahtarıyla birlikte silinir;
 * bu depo Android Auto Backup ile Google Drive'a yedeklenir ve geri gelir.
 * Yalnızca geminiApiKey ve claudeHaikuApiKey bu depoya yazılır.
 */
const RECOVERY_KEYS: SensitiveKey[] = ['geminiApiKey', 'claudeHaikuApiKey', 'groqApiKey', 'tavilyApiKey'];

async function _recoverySet(key: SensitiveKey, value: string): Promise<void> {
  if (!_isNative || !RECOVERY_KEYS.includes(key)) return;
  try {
    await CarLauncher.saveRecoveryKey({ key, value });
  } catch { /* non-critical */ }
}

async function _recoveryGet(key: SensitiveKey): Promise<string> {
  if (!_isNative || !RECOVERY_KEYS.includes(key)) return '';
  try {
    const res = await CarLauncher.loadRecoveryKey({ key });
    return res?.value ?? '';
  } catch { return ''; }
}

async function nativeGet(key: string): Promise<string> {
  try {
    const result = await (CarLauncher as unknown as {
      secureStoreGet: (opts: { key: string }) => Promise<{ value: string | null }>;
    }).secureStoreGet({ key });
    return result?.value ?? '';
  } catch (e) {
    // Gözlemlenebilirlik (Q2): Keystore okuma hatası ile "key yok" ('') ayırt edilemiyordu.
    // Davranış AYNI (boş döner); yalnız hata türü + key ADI loglanır — key DEĞERİ asla.
    logError(`sensitiveKeyStore:nativeGet:${key}`, e);
    return '';
  }
}

async function nativeSet(key: string, value: string): Promise<void> {
  await (CarLauncher as unknown as {
    secureStoreSet: (opts: { key: string; value: string }) => Promise<void>;
  }).secureStoreSet({ key, value });
}

async function nativeRemove(key: string): Promise<void> {
  await (CarLauncher as unknown as {
    secureStoreRemove: (opts: { key: string }) => Promise<void>;
  }).secureStoreRemove({ key });
}

// ── Device Key Backup (Google'sız, uninstall'a dayanıklı dosya yedeği) ──────
//
// Yukarıdaki Recovery Store (EncryptedSharedPreferences silinmeden önce
// SharedPreferences'a yazılan + Android Auto Backup'a dayanan yedek) Google
// hesabı / Google Play Services olmayan cihazlarda (head unit — ana hedef)
// hiçbir zaman geri gelmiyor: sahada `bmgr restore` "No available restore
// sets" verdi. Bu katman anahtarları tek JSON blob olarak native tarafta
// paylaşımlı harici depolamaya (uninstall'da silinmeyen) yazar; Google'a
// bağımlı değildir. Yalnızca RECOVERY_KEYS bu blob'a girer.

interface DeviceBackupBlob {
  v: 1;
  keys: Partial<Record<SensitiveKey, string>>;
}

/** Bu boot'ta cihaz-içi geri yükleme zaten denendi mi (yalnızca 1 kez denenir). */
let _deviceRestoreTried = false;

/** Art arda set() çağrılarında yarış olmasın diye basit zincirleme kuyruk. */
let _backupChain: Promise<void> = Promise.resolve();

async function _deviceBackupSync(): Promise<void> {
  if (!_isNative) return;
  _backupChain = _backupChain.then(async () => {
    try {
      const keys: Partial<Record<SensitiveKey, string>> = {};
      for (const k of RECOVERY_KEYS) {
        const v = await nativeGet(k);
        if (v) keys[k] = v;
      }
      const blob: DeviceBackupBlob = { v: 1, keys };
      await (CarLauncher as unknown as {
        deviceKeyBackupWrite: (opts: { blob: string }) => Promise<void>;
      }).deviceKeyBackupWrite({ blob: JSON.stringify(blob) });
    } catch {
      // Yazma başarısız (izin yok, depolama uygun değil vb.) — anahtar yine
      // EncryptedSharedPreferences + Recovery Store'da kalmaya devam eder;
      // bu yalnızca EK bir yedek katmanıdır, davranış kötüleşmez.
    }
  });
  await _backupChain.catch(() => {});
}

/**
 * Cihaz-içi yedek dosyasından TÜM RECOVERY_KEYS'i geri doldurur.
 * Bulunan anahtar/değer haritasını döndürür (çağıran istenen anahtarı
 * doğrudan haritadan okuyabilir — ekstra native round-trip gerekmez).
 * Hiçbir hata dışarı fırlatmaz (fail-soft); boot başına yalnızca 1 kez denenir.
 */
async function _deviceBackupRestore(): Promise<DeviceBackupBlob['keys'] | null> {
  if (!_isNative || _deviceRestoreTried) return null;
  _deviceRestoreTried = true;
  try {
    const res = await (CarLauncher as unknown as {
      deviceKeyBackupRead: () => Promise<{ blob?: string | null }>;
    }).deviceKeyBackupRead();
    const raw = res?.blob;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceBackupBlob;
    if (!parsed?.keys) return null;
    for (const k of RECOVERY_KEYS) {
      const v = parsed.keys[k];
      if (v) {
        await nativeSet(k, v).catch(() => {});
        await _recoverySet(k, v);
      }
    }
    return parsed.keys;
  } catch {
    // Farklı cihaz (çözülemez) veya bozuk dosya — sessizce vazgeç.
    return null;
  }
}

// ── Web Crypto Fallback (browser/demo mod) ────────────────────────────────
// Static secret YOK — her cihaza özgü rastgele anahtar türetilir.
// Bu fallback yalnızca tarayıcı geliştirme ortamında kullanılır.

const STORE_KEY    = 'car-launcher-sensitive-v2';
const LEGACY_KEY   = 'car-launcher-sensitive-v1'; // eski şifreli format

/** Tarayıcıya özgü anahtar — sessionStorage'dan alınır, yoksa üretilir. */
async function _getWebKey(): Promise<CryptoKey> {
  const SESSION_KEY = 'cls-wk';

  // Var olan raw key'i session'dan al
  const raw64 = sessionStorage.getItem(SESSION_KEY);
  let rawKey: Uint8Array;

  if (raw64) {
    rawKey = Uint8Array.from(atob(raw64), (c) => c.charCodeAt(0));
  } else {
    // İlk çalışmada rastgele AES-256 key üret
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const exp  = await crypto.subtle.exportKey('raw', key);
    rawKey = new Uint8Array(exp);
    sessionStorage.setItem(SESSION_KEY, btoa(String.fromCharCode(...rawKey)));
  }

  return crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function _webEncrypt(plaintext: string): Promise<string> {
  const key    = await _getWebKey();
  const iv     = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const out    = new Uint8Array(12 + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), 12);
  return btoa(Array.from(out).map((b) => String.fromCharCode(b)).join(''));
}

async function _webDecrypt(encoded: string): Promise<string> {
  const key   = await _getWebKey();
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}

function _webLoadRaw(): Record<string, string> {
  try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) as Record<string, string> : {}; }
  catch { return {}; }
}

function _webSaveRaw(store: Record<string, string>): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

async function _webGet(key: string): Promise<string> {
  const store = _webLoadRaw();
  const val   = store[key];
  if (!val) return '';
  try { return await _webDecrypt(val); } catch { return ''; }
}

async function _webSet(key: string, value: string): Promise<void> {
  const store = _webLoadRaw();
  if (!value) { delete store[key]; }
  else { store[key] = await _webEncrypt(value); }
  _webSaveRaw(store);
}

// ── One-time migration: v1 → native ──────────────────────────────────────

let _migrated = false;

async function _migrateToNative(): Promise<void> {
  if (_migrated || !_isNative) { _migrated = true; return; }
  _migrated = true;

  try {
    if (localStorage.getItem(LEGACY_KEY)) {
      localStorage.removeItem(LEGACY_KEY);
      logInfo('[sensitiveKeyStore] v1 → v2 migration: eski şifreli depo temizlendi');
    }
  } catch { /* ignore */ }
}

// ── Public API ────────────────────────────────────────────────────────────

export const sensitiveKeyStore = {
  async get(key: SensitiveKey): Promise<string> {
    await _migrateToNative();
    if (_isNative) {
      const val = await nativeGet(key);
      if (val) return val;
      // EncryptedSharedPreferences boş — reinstall sonrası recovery'den geri yükle
      const recovered = await _recoveryGet(key);
      if (recovered) {
        // Bulundu → EncryptedSharedPreferences'a geri yaz (bir sonraki okumada hızlı)
        await nativeSet(key, recovered).catch(() => {});
        return recovered;
      }
      // Üçüncü basamak: Google Auto Backup hiç oluşmamış olabilir (head unit'te
      // Google Play Services yok) — cihaz-içi dosya yedeğinden geri yükle.
      if (RECOVERY_KEYS.includes(key)) {
        const restoredKeys = await _deviceBackupRestore();
        const fromDevice = restoredKeys?.[key];
        if (fromDevice) return fromDevice;
      }
      return '';
    }
    return _webGet(key);
  },

  async set(key: SensitiveKey, value: string): Promise<void> {
    await _migrateToNative();
    if (_isNative) {
      await nativeSet(key, value);
      // Recovery store'a da yaz — reinstall/güncelleme sonrası kaybolmasın
      await _recoverySet(key, value);
      // Cihaz-içi dosya yedeği — Google'a bağımlı olmayan üçüncü katman.
      // Yalnızca RECOVERY_KEYS blob içeriğini etkiler; alakasız anahtar
      // (nav_history, geofence_* vb.) set'i gereksiz disk yazımı tetiklemez.
      // Fire-and-forget: anahtar kaydı nadir bir olay, kullanıcıyı bloklamaz.
      if (RECOVERY_KEYS.includes(key)) void _deviceBackupSync();
      return;
    }
    await _webSet(key, value);
  },

  async has(key: SensitiveKey): Promise<boolean> {
    const v = await this.get(key);
    return v.length > 0;
  },

  async remove(key: SensitiveKey): Promise<void> {
    if (_isNative) {
      await nativeRemove(key);
      // Bilinçli silme TÜM yedek katmanlarına yansımalı — yoksa anahtar bir
      // sonraki get()'te recovery'den, reinstall'da da cihaz blob'undan geri
      // dirilirdi. Recovery boş değerle ezilir; cihaz blob sync'i güncel
      // değerleri nativeGet ile topladığından silinen anahtar otomatik düşer.
      await _recoverySet(key, '');
      if (RECOVERY_KEYS.includes(key)) void _deviceBackupSync();
      return;
    }
    const store = _webLoadRaw();
    delete store[key];
    _webSaveRaw(store);
  },
};

// ── React hook ────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';

export function useSensitiveKey(key: SensitiveKey): [string, (v: string) => Promise<void>] {
  const [value, setValue] = useState('');

  useEffect(() => {
    let alive = true;
    sensitiveKeyStore.get(key).then((v) => { if (alive) setValue(v); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);

  const set = useCallback(async (v: string) => {
    await sensitiveKeyStore.set(key, v);
    setValue(v);
  }, [key]);

  return [value, set];
}
