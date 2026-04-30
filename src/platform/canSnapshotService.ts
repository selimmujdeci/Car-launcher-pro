/**
 * CAN Snapshot Service — Two-Tier Atomic WebView Crash Recovery
 *
 * Sorun:
 *   Android bellek baskısı WebView'i ani şekilde öldürebilir.
 *   WebView yeniden başladığında localStorage bile zaman zaman
 *   bozulur veya erişilemez olur. Sürücü 0 km/h / boş gösterge görür.
 *
 * Çözüm — İki Katmanlı Depolama:
 *   Tier 1 · localStorage  — senkron okuma (sıfır gecikme hydration)
 *                            1s debounce ile yaz
 *   Tier 2 · Capacitor Filesystem / Directory.Data
 *                          — gerçek native depolama (WebView crash'ten bağımsız)
 *                            5s throttle ile yaz (Mali-400 I/O budget korunur)
 *
 * Stale (Bayat) Veri Eşikleri (per-field age-based):
 *   Dinamik  (speed, rpm)         :  30 s  → hareket halindeyse anlamsız
 *   Yarı-statik (engineTemp)      :   5 dk → ısı değişimi yavaş
 *   Statik   (fuelLevel, batarya) :  12 sa → park süresini karşılar
 *
 * Hydration Akışı:
 *   1. Modül yüklenirken: sync localStorage okuma → _current'a anlık uygula
 *   2. Arka planda async: Filesystem okuma → gerçek veri yoksa patch uygula
 *
 * CLAUDE.md Uyum:
 *   - Mali-400'de I/O kilitlenmesi: Filesystem yazımı 5s throttle
 *   - Bellek sızıntısı: tüm timer'lar stopCanSnapshot() ile temizlenir
 *   - Circular dep: obdService import ETMEZ, sadece `type` kullanır
 */

import { Capacitor } from '@capacitor/core';
import { safeSetRaw, safeGetRaw, safeSetRawImmediate } from '../utils/safeStorage';
import { logError } from './crashLogger';
import type { OBDData } from './obdService';

/* ── Stale thresholds ───────────────────────────────────────────── */

const STALE_DYNAMIC_MS     = 30_000;          // speed, rpm — 30 s
const STALE_SEMI_STATIC_MS = 5 * 60_000;      // engineTemp — 5 dk
const STALE_STATIC_MS      = 12 * 60 * 60_000; // fuel, battery, vehicleType — 12 sa

/* ── Throttle constants ─────────────────────────────────────────── */

const LS_DEBOUNCE_MS  = 1_000;  // localStorage: 1s debounce
const FS_THROTTLE_MS  = 5_000;  // Filesystem: en fazla 5s'de bir yazım

/* ── Snapshot format ────────────────────────────────────────────── */

type CanSnapshot = {
  ts:           number;  // yazım zamanı (Unix ms)
  speed:        number;
  rpm:          number;
  engineTemp:   number;
  fuelLevel:    number;
  batteryLevel: number;
  batteryTemp:  number;
  range:        number;
  vehicleType:  OBDData['vehicleType'];
};

const LS_KEY   = 'car-can-snapshot';        // localStorage anahtarı
const FS_PATH  = 'can_snapshot.json';       // native dosya adı

/* ── Module state ───────────────────────────────────────────────── */

let _lastData: CanSnapshot | null = null;

// Tier 1 — localStorage timer (safeSetRaw tarafından yönetilir)
// Tier 2 — Filesystem throttle state
let _fsTimer: ReturnType<typeof setTimeout> | null = null;
let _fsLastWriteTs = 0;

/* ── Filesystem helpers (Tier 2) ────────────────────────────────── */

async function _fsWrite(snap: CanSnapshot): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path:      FS_PATH,
      data:      JSON.stringify(snap),
      directory: Directory.Data,
      encoding:  Encoding.UTF8,
    });
  } catch (e) {
    logError('CanSnapshot:FSWrite', e);
  }
}

async function _fsRead(): Promise<CanSnapshot | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const result = await Filesystem.readFile({
      path:      FS_PATH,
      directory: Directory.Data,
      encoding:  Encoding.UTF8,
    });
    return JSON.parse(result.data as string) as CanSnapshot;
  } catch {
    return null;
  }
}

/**
 * Filesystem throttle: en fazla FS_THROTTLE_MS'de bir yazım.
 * İlk çağrı anında yazar; sonrakiler kalan süreyi bekler.
 */
function _scheduleFsWrite(snap: CanSnapshot): void {
  const now        = Date.now();
  const sinceWrite = now - _fsLastWriteTs;

  if (_fsTimer !== null) clearTimeout(_fsTimer);

  if (sinceWrite >= FS_THROTTLE_MS) {
    // Yeterli süre geçti — hemen yaz
    _fsLastWriteTs = now;
    void _fsWrite(snap);
  } else {
    // Kalan süreyi bekle, sonra en güncel veriyi yaz
    const remaining = FS_THROTTLE_MS - sinceWrite;
    _fsTimer = setTimeout(() => {
      _fsTimer = null;
      _fsLastWriteTs = Date.now();
      if (_lastData) void _fsWrite(_lastData);
    }, remaining);
  }
}

/* ── Stale-aware hydration helper ───────────────────────────────── */

/**
 * Snapshot'tan OBDData patch oluştur.
 * Her alan için ayrı stale eşiği uygulanır.
 * Bayat alanlar patch'e DAHİL EDİLMEZ — INITIAL değerleri korunur.
 */
function _buildPatch(snap: CanSnapshot): Partial<OBDData> {
  const age   = Date.now() - snap.ts;
  const patch: Partial<OBDData> = {};

  // Dinamik alanlar (30s eşiği)
  if (age < STALE_DYNAMIC_MS) {
    patch.speed = snap.speed;
    patch.rpm   = snap.rpm;
  }

  // Yarı-statik (5dk eşiği)
  if (age < STALE_SEMI_STATIC_MS) {
    patch.engineTemp = snap.engineTemp;
  }

  // Statik alanlar (12sa eşiği)
  if (age < STALE_STATIC_MS) {
    patch.fuelLevel    = snap.fuelLevel;
    patch.batteryLevel = snap.batteryLevel;
    patch.batteryTemp  = snap.batteryTemp;
    patch.range        = snap.range;
    patch.vehicleType  = snap.vehicleType;
  }

  return patch;
}

/* ── Public API ─────────────────────────────────────────────────── */

/**
 * SYNC hydration — modül yüklenirken localStorage'dan anlık oku.
 * obdService._current başlangıcına uygulanır; gecikme yok.
 */
export function hydrateCanSnapshotSync(): Partial<OBDData> {
  try {
    const raw = safeGetRaw(LS_KEY);
    if (!raw) return {};
    const snap: CanSnapshot = JSON.parse(raw);
    const patch = _buildPatch(snap);
    if (Object.keys(patch).length > 0) {
      _lastData = snap; // in-memory'yi de doldur
    }
    return patch;
  } catch {
    return {};
  }
}

/**
 * ASYNC hydration — Filesystem'den oku, localStorage'dan daha güncel/güvenilir ise
 * OBDData patch döndür. Gerçek veri akışı başlamadan önce uygulanmalıdır.
 *
 * Bağımsız olarak yüklenir; hata durumunda silently {} döner.
 */
export async function hydrateCanSnapshotAsync(): Promise<Partial<OBDData>> {
  try {
    const snap = await _fsRead();
    if (!snap) return {};

    // localStorage'daki snapshot ile karşılaştır — hangisi daha yeni?
    const lsRaw  = safeGetRaw(LS_KEY);
    const lsSnap = lsRaw ? (JSON.parse(lsRaw) as CanSnapshot) : null;
    if (lsSnap && lsSnap.ts >= snap.ts) return {}; // localStorage zaten daha güncel

    const patch = _buildPatch(snap);
    if (Object.keys(patch).length > 0) {
      _lastData = snap;
      // Filesystem'deki veriyi localStorage'a da yaz (sync okuma için senkronize)
      safeSetRaw(LS_KEY, JSON.stringify(snap), 0);
    }
    return patch;
  } catch {
    return {};
  }
}

/**
 * Kritik CAN verisini iki katmana paralel olarak kaydet.
 * Yalnızca source='real' verisi için çağrılır — mock persist edilmez.
 *
 * Tier 1: safeSetRaw (1s debounce — localStorage)
 * Tier 2: _scheduleFsWrite (5s throttle — native Filesystem)
 */
export function scheduleCanSnapshot(data: OBDData): void {
  _lastData = {
    ts:           Date.now(),
    speed:        data.speed,
    rpm:          data.rpm,
    engineTemp:   data.engineTemp,
    fuelLevel:    data.fuelLevel,
    batteryLevel: data.batteryLevel,
    batteryTemp:  data.batteryTemp,
    range:        data.range,
    vehicleType:  data.vehicleType,
  };

  // Tier 1 — hızlı, senkron okuma için
  safeSetRaw(LS_KEY, JSON.stringify(_lastData), LS_DEBOUNCE_MS);

  // Tier 2 — native, gerçek crash koruması
  _scheduleFsWrite(_lastData);
}

/**
 * Güç kesimi / Android backgrounding: tüm bekleyen yazımları anında temizle.
 * Hem localStorage'a hem filesystem'e atomik olarak yaz.
 * obdService.stopOBD() ve window pagehide tarafından çağrılır.
 */
export function flushCanSnapshotNow(data?: OBDData): void {
  const snap = data
    ? { ts: Date.now(), speed: data.speed, rpm: data.rpm, engineTemp: data.engineTemp,
        fuelLevel: data.fuelLevel, batteryLevel: data.batteryLevel,
        batteryTemp: data.batteryTemp, range: data.range, vehicleType: data.vehicleType }
    : _lastData;
  if (!snap) return;

  snap.ts = Date.now(); // zaman damgasını yenile

  // Tier 1 — buffer bypass
  safeSetRawImmediate(LS_KEY, JSON.stringify(snap));

  // Tier 2 — throttle bypass: timer iptal et, hemen yaz
  if (_fsTimer !== null) { clearTimeout(_fsTimer); _fsTimer = null; }
  _fsLastWriteTs = snap.ts;
  void _fsWrite(snap);
}

/** Servis durdurulduğunda timer'ları temizle (CLAUDE.md §1 sıfır sızıntı). */
export function stopCanSnapshot(): void {
  if (_fsTimer !== null) { clearTimeout(_fsTimer); _fsTimer = null; }
}

/* ── Atomic flush on page hide ──────────────────────────────────── */
// Android bellek baskısı veya ekran kapatma → pagehide → anında flush.
// 'once: false' — birden fazla app lifecycle döngüsü desteklenir.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushCanSnapshotNow());
}
