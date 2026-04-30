/**
 * BatteryProtectionService — Low Voltage Guard (Akü Koruma Zırhı)
 *
 * 12V kurşun-asit akü voltajını izler, düşük voltajda sistemi kademeli
 * olarak kısıtlar. BatteryProtectionService araç ekosistemini koruyan
 * son savunma hattıdır — araç çalışmıyorken uygulama aklatarken
 * akünün tamamen boşalmasını önler.
 *
 * Veri kaynağı:
 *   updateBatteryVoltage(v) → CAN bus / native voltmetre / OBD PID 0x42
 *   onOBDData subscription → obdService.batteryVoltage (OBD bağlıysa)
 *
 * Seviyeler (aşağı geçiş):
 *   ≥ 12.0V → NORMAL           (kısıtlama yok)
 *   < 12.0V → WARN             (kullanıcı bildirimi, BALANCED tavan)
 *   < 11.8V → DEEP_SLEEP       (POWER_SAVE modu, internet polling 5dk'ya)
 *   < 11.5V → EMERGENCY_SHUTDOWN (SAFE_MODE, servisler durduruluyor)
 *
 * Hysteresis (yukarı geçiş, voltaj toparlıyorsa):
 *   ≥ 12.1V → NORMAL'a geri
 *   ≥ 11.9V → WARN'a geri
 *   ≥ 11.7V → DEEP_SLEEP'e geri
 *
 * Moving Average:
 *   Son 10 saniyedeki örneklerin zaman ağırlıklı ortalaması alınır.
 *   OBD bağlantısı kesilip yeniden gelirse buffer temizlenir.
 *
 * Zero-Leak:
 *   stopBatteryProtection() tüm abonelikleri ve power ceiling'i temizler.
 */

import { onOBDData }      from '../obdService';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }    from '../../core/runtime/runtimeTypes';
import { logError }       from '../crashLogger';

// ── Seviye tipi ────────────────────────────────────────────────────────────

export type BatteryLevel =
  | 'NORMAL'
  | 'WARN'
  | 'DEEP_SLEEP'
  | 'EMERGENCY_SHUTDOWN';

// ── Eşikler (aşağı geçiş) ─────────────────────────────────────────────────

const THRESH_WARN      = 12.0;  // V
const THRESH_SLEEP     = 11.8;  // V
const THRESH_EMERGENCY = 11.5;  // V

// ── Histerezis (yukarı toparlanma) ────────────────────────────────────────

const HYST_NORMAL = 12.1;  // WARN → NORMAL için gerekli voltaj
const HYST_WARN   = 11.9;  // DEEP_SLEEP → WARN için
const HYST_SLEEP  = 11.7;  // EMERGENCY → DEEP_SLEEP için

// ── 10 Saniyelik Hareketli Ortalama ───────────────────────────────────────

const MA_WINDOW_MS = 10_000;

interface _Sample { v: number; ts: number }
const _samples: _Sample[] = [];

/**
 * Yeni örneği ekle, 10 saniyelik pencereyi güncelle, ortalama döner.
 * Eski örnekleri splice ile sil — max 10 örnek (1Hz OBD = 10s), düşük maliyet.
 */
function _pushSample(v: number): number {
  const now    = Date.now();
  const cutoff = now - MA_WINDOW_MS;

  _samples.push({ v, ts: now });

  // Pencere dışı eski örnekleri temizle
  let stale = 0;
  while (stale < _samples.length && _samples[stale]!.ts < cutoff) stale++;
  if (stale > 0) _samples.splice(0, stale);

  // Aritmetik ortalama — penceredeki tüm örnekler eşit ağırlıklı
  const sum = _samples.reduce((acc, s) => acc + s.v, 0);
  return sum / _samples.length;
}

// ── Modül state ────────────────────────────────────────────────────────────

let _level:         BatteryLevel = 'NORMAL';
let _active         = false;
let _lastNotifyMs   = 0;
let _unsubOBD:      (() => void) | null = null;

const _listeners = new Set<(level: BatteryLevel, avgV: number) => void>();

const NOTIFY_THROTTLE_MS = 30_000; // 30s — aynı level için tekrar toast gösterme

// ── Histerezis durum makinesi ──────────────────────────────────────────────

/**
 * Mevcut seviyeye göre voltajı değerlendir.
 * Aşağı geçiş: ham eşikler kullanılır (hızlı tepki).
 * Yukarı geçiş: daha yüksek eşikler (voltaj titremesi önleme).
 */
function _computeLevel(avgV: number): BatteryLevel {
  switch (_level) {
    case 'NORMAL':
      if (avgV < THRESH_EMERGENCY) return 'EMERGENCY_SHUTDOWN';
      if (avgV < THRESH_SLEEP)     return 'DEEP_SLEEP';
      if (avgV < THRESH_WARN)      return 'WARN';
      return 'NORMAL';

    case 'WARN':
      if (avgV < THRESH_EMERGENCY) return 'EMERGENCY_SHUTDOWN';
      if (avgV < THRESH_SLEEP)     return 'DEEP_SLEEP';
      if (avgV >= HYST_NORMAL)     return 'NORMAL';
      return 'WARN';

    case 'DEEP_SLEEP':
      if (avgV < THRESH_EMERGENCY) return 'EMERGENCY_SHUTDOWN';
      if (avgV >= HYST_WARN)       return 'WARN';
      return 'DEEP_SLEEP';

    case 'EMERGENCY_SHUTDOWN':
      if (avgV >= HYST_SLEEP)      return 'DEEP_SLEEP';
      return 'EMERGENCY_SHUTDOWN';
  }
}

// ── Seviye geçişi uygula ───────────────────────────────────────────────────

/**
 * RuntimeManager power ceiling + kullanıcı bildirimi.
 * Aynı seviyede tekrar çağrı → no-op (durum değişmedi).
 */
function _applyLevel(newLevel: BatteryLevel, avgV: number): void {
  if (newLevel === _level) return;

  const prev  = _level;
  _level      = newLevel;

  // ── RuntimeManager power ceiling ────────────────────────────────────────
  // Her seviye için maksimum izin verilen RuntimeMode belirlenir.
  // runtimeManager.setPowerCeiling() bu modun üstüne çıkmayı engeller.
  const ceilings: Record<BatteryLevel, RuntimeMode | null> = {
    NORMAL:              null,                     // kısıtlama yok
    WARN:                RuntimeMode.BALANCED,     // PERFORMANCE yasak
    DEEP_SLEEP:          RuntimeMode.POWER_SAVE,   // yalnızca SAFE/POWER_SAVE
    EMERGENCY_SHUTDOWN:  RuntimeMode.SAFE_MODE,    // yalnızca SAFE_MODE
  };
  runtimeManager.setPowerCeiling(ceilings[newLevel]);

  // ── Listener'ları bildir ─────────────────────────────────────────────────
  // onBatteryLevel(): servisler kendi shutdown mantığını burada yönetir.
  _listeners.forEach((fn) => fn(newLevel, avgV));

  // ── Kullanıcı toast bildirimi ────────────────────────────────────────────
  const now = Date.now();
  if (now - _lastNotifyMs >= NOTIFY_THROTTLE_MS && newLevel !== 'NORMAL') {
    _lastNotifyMs = now;

    const toastMap: Partial<Record<BatteryLevel, { type: 'warning' | 'error'; title: string }>> = {
      WARN: {
        type:  'warning',
        title: `⚡ Akü voltajı düşük: ${avgV.toFixed(1)} V — Şarj önerilir`,
      },
      DEEP_SLEEP: {
        type:  'warning',
        title: `⚠️ Akü kritik (${avgV.toFixed(1)} V) — Enerji tasarrufu modu aktif`,
      },
      EMERGENCY_SHUTDOWN: {
        type:  'error',
        title: `🔴 Akü çok kritik (${avgV.toFixed(1)} V) — Servisler durduruluyor`,
      },
    };

    const t = toastMap[newLevel];
    if (t) {
      void import('../errorBus').then(({ showToast }) => showToast(t));
    }
  }

  // Konsol logu — adb logcat görünürlüğü
  const isDowngrade = _rankOf(newLevel) > _rankOf(prev);
  (isDowngrade ? console.warn : console.info)(
    `[Battery] ${prev} → ${newLevel} @ ${avgV.toFixed(2)} V`,
  );
}

/** Seviye karşılaştırma yardımcısı — downgrade tespiti için */
function _rankOf(l: BatteryLevel): number {
  return { NORMAL: 0, WARN: 1, DEEP_SLEEP: 2, EMERGENCY_SHUTDOWN: 3 }[l];
}

// ── Ana işleme ─────────────────────────────────────────────────────────────

function _processVoltage(v: number): void {
  if (!_active) return;

  // Sanity: 12V hattı için fiziksel olarak mümkün aralık
  if (!Number.isFinite(v) || v < 8 || v > 16) {
    logError('Battery:Voltage', new Error(`Geçersiz voltaj: ${v} V`));
    return;
  }

  const avg      = _pushSample(v);
  const newLevel = _computeLevel(avg);
  _applyLevel(newLevel, avg);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Akü koruma servisini başlatır.
 * App.tsx'te bir kez çağrılmalı; dönen thunk cleanup fonksiyonudur.
 * İdempotent: tekrar çağrı güvenli.
 */
export function startBatteryProtection(): () => void {
  if (_active) return stopBatteryProtection;
  _active       = true;
  _level        = 'NORMAL';
  _samples.length = 0; // buffer sıfırla

  // OBD'den batteryVoltage dinle (PID 0x42 destekli adaptörlerde gelir)
  _unsubOBD = onOBDData((d) => {
    const v = d.batteryVoltage;
    if (v != null && v > 0) _processVoltage(v);
  });

  return stopBatteryProtection;
}

export function stopBatteryProtection(): void {
  if (!_active) return;
  _active = false;
  _unsubOBD?.(); _unsubOBD = null;
  _samples.length = 0;

  // Ceiling'i kaldır — servis dururken kısıtlama kalmasın
  runtimeManager.setPowerCeiling(null);
  _level = 'NORMAL';
}

/**
 * Harici voltaj kaynağından besleme — CAN bus, native voltmetre veya test.
 * obdService'e ek olarak çağrılabilir; her ikisi çakışmaz.
 */
export function updateBatteryVoltage(v: number): void {
  _processVoltage(v);
}

/** Anlık akü koruma seviyesini döner. */
export function getBatteryLevel(): BatteryLevel { return _level; }

/**
 * Seviye değişimlerine abone ol.
 * EMERGENCY_SHUTDOWN'da servisler kendi shutdown mantığını çalıştırabilir.
 *
 * @returns cleanup thunk — useEffect cleanup'ta çağır (Zero-Leak).
 */
export function onBatteryLevel(
  cb: (level: BatteryLevel, avgVoltage: number) => void,
): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/* ── HMR cleanup ──────────────────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopBatteryProtection();
    _listeners.clear();
  });
}
