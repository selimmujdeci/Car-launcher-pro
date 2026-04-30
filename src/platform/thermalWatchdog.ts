/**
 * thermalWatchdog.ts — Shield Thermal Management
 *
 * Periyodik sıcaklık okuma (30s), kademeli kısıtlama ve self-healing soğuma.
 *
 * Sıcaklık kaynakları (öncelik sırasıyla):
 *   1. injectDeviceTemp() — native plugin entegrasyonu (CarLauncher gelecek sürüm)
 *   2. OBD batteryTemp   — EV akü paketi (araç içi sıcaklık proxy)
 *   3. OBD engineTemp    — motor soğutma suyu
 *   4. Battery API       — şarj durumu heuristic (sıcaklık yoksa)
 *
 * Kademeler ve histerezis:
 *   Giriş:  ≥45°C → L1  |  ≥55°C → L2  |  ≥65°C → L3
 *   Çıkış:  <40°C → L0  |  <50°C → L1  |  <60°C → L2
 *
 * L1 (45°C): Harita FPS sinyali (--thermal-level CSS var), OBD yavaşlatma sinyali
 * L2 (55°C): Parlaklık %50, Radar Community Sync duraklat, uyarı toast
 * L3 (65°C): Kritik toast + TTS + parlaklık %30 (minimum yük modu)
 * L0 (<40°C): Tüm kısıtlamalar kaldırılır, self-healing restore
 *
 * Write Throttling: safeSetRaw yalnızca seviye değişiminde çağrılır (eMMC ömrü).
 * Zero-Leak: stop() tüm timer ve aboneliği temizler.
 */

import { useSyncExternalStore }                         from 'react';
import { onOBDData }                                    from './obdService';
import { setBrightness }                                from './systemSettingsService';
import { stopCommunitySync, startCommunitySync,
         isCommunitySync }                              from './radar/radarCommunityService';
import { showToast }                                    from './errorBus';
import { speakAlert }                                   from './ttsService';
import { useStore }                                     from '../store/useStore';
import { safeSetRaw, safeGetRaw }                       from '../utils/safeStorage';
import { runtimeManager }                               from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }                                  from '../core/runtime/runtimeTypes';

/* ══════════════════════════════════════════════════════════════════════════
   Tipler
══════════════════════════════════════════════════════════════════════════ */

export type ThermalLevel = 0 | 1 | 2 | 3;

export interface ThermalSnapshot {
  level:  ThermalLevel;
  /** Bilinen sıcaklık (°C). Kaynak yoksa NaN. */
  tempC:  number;
  source: 'injected' | 'obd_battery' | 'obd_engine' | 'battery_heuristic' | 'unknown';
  ts:     number;
}

type ThermalCallback = (snap: ThermalSnapshot) => void;

/* ══════════════════════════════════════════════════════════════════════════
   Sabitler
══════════════════════════════════════════════════════════════════════════ */

const POLL_MS     = 30_000;      // Battery API kontrol periyodu (ms)
const STORAGE_KEY = 'tw-state';  // safeStorage anahtarı
const RESTORE_TTL = 5 * 60_000;  // Eski snapshot'ı yoksay (5 dk)

// Giriş / Çıkış eşikleri — 5°C histerezis bandı
const ENTER: readonly [number, number, number] = [45, 55, 65];
const EXIT:  readonly [number, number, number] = [40, 50, 60];

/* ══════════════════════════════════════════════════════════════════════════
   Modül state
══════════════════════════════════════════════════════════════════════════ */

let _level:             ThermalLevel               = 0;
let _tempC:             number                     = NaN;
let _source:            ThermalSnapshot['source']  = 'unknown';
let _injectedPriority   = false;   // native inject varsa OBD'yi geç
let _running            = false;
let _tickTimer:         ReturnType<typeof setInterval> | null = null;
let _obdUnsub:          (() => void) | null = null;
let _radarWasPaused     = false;
let _savedBrightness:   number | null = null;
let _lastPersistLevel:  number = -1;   // ilk yazmayı zorla
/** runtimeManager.subscribe cleanup — Zero-Leak */
let _runtimeUnsub:      (() => void) | null = null;

// useSyncExternalStore için
let _storeSnap: ThermalSnapshot = { level: 0, tempC: NaN, source: 'unknown', ts: 0 };
const _storeListeners  = new Set<() => void>();
const _thermalCallbacks = new Set<ThermalCallback>();

/* ══════════════════════════════════════════════════════════════════════════
   Battery API tipi (TS libde yok)
══════════════════════════════════════════════════════════════════════════ */

interface BatteryManager {
  readonly charging:        boolean;
  readonly chargingTime:    number;
  readonly dischargingTime: number;
  readonly level:           number;
}

interface NavigatorWithBattery extends Navigator {
  getBattery(): Promise<BatteryManager>;
}

/* ══════════════════════════════════════════════════════════════════════════
   Histerezis seviye hesabı
══════════════════════════════════════════════════════════════════════════ */

/**
 * Geçerli sıcaklık ve mevcut seviye üzerinden hedef seviyeyi hesaplar.
 * Özyinelemeli çağrı birden fazla seviye düşüşünü tek adımda çözer.
 */
function _computeLevel(tempC: number, cur: ThermalLevel): ThermalLevel {
  if (!isFinite(tempC)) return 0;

  // Giriş: anında yüksek seviyeye geç (histerezis yok — güvenlik öncelikli)
  if (cur < 3 && tempC >= ENTER[2]) return 3;
  if (cur < 2 && tempC >= ENTER[1]) return 2;
  if (cur < 1 && tempC >= ENTER[0]) return 1;

  // Çıkış: histerezis — soğuma eşiği karşılanınca bir alt seviyeye geç
  // Özyinelemeli çağrı: 65→35°C tek seferde 3→0 yapabilir
  if (cur === 3 && tempC < EXIT[2]) return _computeLevel(tempC, 2);
  if (cur === 2 && tempC < EXIT[1]) return _computeLevel(tempC, 1);
  if (cur === 1 && tempC < EXIT[0]) return 0;

  return cur;
}

/* ══════════════════════════════════════════════════════════════════════════
   RuntimeEngine entegrasyonu — termal seviyeye göre mod zorlaması
══════════════════════════════════════════════════════════════════════════ */

/**
 * Termal seviyeyi RuntimeEngine'e iletir.
 *
 * Eşleme (CLAUDE.md §2 Sensor Resiliency):
 *   L0 (<40°C) → thermalFloor kaldırılır, upgrade penceresi açılır
 *   L1 (≥45°C) → BASIC_JS zorla (blur/animasyon kapalı, GPU yükü azalır)
 *   L2 (≥55°C) → BASIC_JS zorla (L1 ile aynı, parlaklık kısıtlaması L2'de)
 *   L3 (≥65°C) → SAFE_MODE zorla (minimum kaynak tüketimi)
 *
 * Not: Downgrade anında, upgrade 30s stabilite bekler (ARM hysteresis).
 */
function _notifyRuntime(level: ThermalLevel): void {
  if (level >= 2) {
    // L2 / L3: yüksek ısı → anlık SAFE_MODE downgrade
    runtimeManager.setMode(RuntimeMode.SAFE_MODE, 'High Temperature');
  } else if (level === 1) {
    // L1: hafif ısınma → blur/anim kapalı, GPU tasarrufu
    runtimeManager.setMode(RuntimeMode.BASIC_JS, 'thermal-warm');
  } else {
    // L0: soğuma → performans geri yükleme (30s upgrade hysteresis devrede)
    runtimeManager.setMode(RuntimeMode.PERFORMANCE, 'Cooling Recovery');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   CSS termal sinyali (map FPS + OBD throttle sinyal kanalı)
══════════════════════════════════════════════════════════════════════════ */

function _setCSSLevel(level: ThermalLevel): void {
  const root = document.documentElement;
  if (level === 0) {
    root.style.removeProperty('--thermal-level');
  } else {
    root.style.setProperty('--thermal-level', String(level));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Seviye geçiş aksiyonları
══════════════════════════════════════════════════════════════════════════ */

function _onEnter(level: ThermalLevel): void {
  _setCSSLevel(level);

  switch (level) {
    case 1:
      // L1: CSS var seti yeterli.
      // Map bileşenleri `--thermal-level` okuyarak FPS'yi kısıtlar.
      // OBD servisi `getThermalLevel()` ile poll aralığını ayarlayabilir.
      break;

    case 2: {
      // Parlaklık %50'ye sabitle
      _savedBrightness = useStore.getState().settings.brightness ?? 80;
      setBrightness(50);

      // Radar Community Sync duraklat (ağ trafiği → CPU/ısı azalır)
      if (isCommunitySync()) {
        _radarWasPaused = true;
        stopCommunitySync();
      }

      showToast({
        type:     'warning',
        title:    'Termal Uyarı',
        message:  `Sıcaklık yüksek (${isFinite(_tempC) ? Math.round(_tempC) + '°C' : '?'}). Parlaklık düşürüldü.`,
        duration: 6000,
      });
      break;
    }

    case 3: {
      // Kritik — minimum yük modu
      if (_savedBrightness === null) {
        _savedBrightness = useStore.getState().settings.brightness ?? 80;
      }
      setBrightness(30);

      // Radar zaten L2'de durdurulmuş olabilir; değilse şimdi durdur
      if (!_radarWasPaused && isCommunitySync()) {
        _radarWasPaused = true;
        stopCommunitySync();
      }

      showToast({
        type:     'error',
        title:    'Cihaz Aşırı Isındı',
        message:  `Sıcaklık ${isFinite(_tempC) ? Math.round(_tempC) + '°C' : 'kritik seviyede'}. Minimum yük moduna geçildi.`,
        duration: 0,   // kalıcı — kullanıcı kapatana kadar
      });
      speakAlert('Cihaz aşırı ısındı, dikkat et');
      break;
    }
  }
}

function _onExit(fromLevel: ThermalLevel, toLevel: ThermalLevel): void {
  _setCSSLevel(toLevel);

  // Parlaklığı geri yükle (L2/L3'ten L1 veya L0'a düşünce)
  if (fromLevel >= 2 && toLevel < 2 && _savedBrightness !== null) {
    setBrightness(_savedBrightness);
    _savedBrightness = null;
  }

  // Radar'ı yeniden başlat (L2/L3'ten L1 veya L0'a düşünce)
  if (fromLevel >= 2 && toLevel < 2 && _radarWasPaused) {
    _radarWasPaused = false;
    void startCommunitySync();
  }

  // Soğuma bildirimi (yalnızca L0'a dönüşte)
  if (toLevel === 0) {
    _setCSSLevel(0);
    showToast({
      type:     'success',
      title:    'Termal Normal',
      message:  'Cihaz sıcaklığı güvenli sınıra döndü.',
      duration: 4000,
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Seviye geçiş koordinatörü
══════════════════════════════════════════════════════════════════════════ */

function _applyTemp(tempC: number, source: ThermalSnapshot['source']): void {
  _tempC  = tempC;
  _source = source;

  const next = _computeLevel(tempC, _level);
  if (next === _level) return;

  const prev  = _level;
  _level = next;

  if (next > prev) {
    _onEnter(next);
  } else {
    _onExit(prev, next);
  }

  // Runtime Engine'e termal seviye değişimini ilet
  _notifyRuntime(next);

  // Persistence: yalnızca seviye değişiminde yaz (Write Throttling — eMMC ömrü)
  if (_level !== _lastPersistLevel) {
    _lastPersistLevel = _level;
    safeSetRaw(
      STORAGE_KEY,
      JSON.stringify({ level: _level, tempC: isFinite(tempC) ? tempC : null, ts: Date.now() }),
    );
  }

  // Subscriber bildirimi
  const snap: ThermalSnapshot = { level: _level, tempC, source, ts: Date.now() };
  _storeSnap = snap;
  _storeListeners.forEach(l => l());
  _thermalCallbacks.forEach(cb => cb(snap));
}

/* ══════════════════════════════════════════════════════════════════════════
   Sıcaklık okuma — OBD
══════════════════════════════════════════════════════════════════════════ */

function _subscribeOBD(): void {
  _obdUnsub = onOBDData((data) => {
    if (_injectedPriority) return; // native inject varsa OBD'yi yoksay

    // EV akü paketi → cihaz ısısı için en alakalı kaynak
    if (data.batteryTemp != null && data.batteryTemp > 0) {
      _applyTemp(data.batteryTemp, 'obd_battery');
      return;
    }
    // Motor soğutma suyu (ICE) — araç kaynaklı sıcaklık
    if (data.engineTemp > 0) {
      _applyTemp(data.engineTemp, 'obd_engine');
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Sıcaklık okuma — Battery API (30s periyodik)
══════════════════════════════════════════════════════════════════════════ */

async function _pollBatteryAPI(): Promise<void> {
  if (_injectedPriority || isFinite(_tempC)) return; // daha iyi kaynak varsa atla

  const nav = navigator as NavigatorWithBattery;
  if (typeof nav.getBattery !== 'function') return;

  try {
    const battery = await nav.getBattery();

    // Battery API sıcaklık verisi sağlamaz.
    // Heuristic: hızlı şarj + düşük batarya seviyesi → olası ısınma sinyali.
    // Düşük güven — sadece başka kaynak yoksa kullanılır ve yalnızca L1 için.
    if (battery.charging && battery.level < 0.25) {
      _applyTemp(43, 'battery_heuristic'); // L1 giriş eşiğine yakın, L2 altında
    }
  } catch {
    // Battery API erişim hatası — sessiz geç
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Public API
══════════════════════════════════════════════════════════════════════════ */

/**
 * Termal watchdog'u başlatır. Idempotent.
 * App.tsx'te uygulama yüklenince bir kez çağrılmalı.
 */
export function startThermalWatchdog(): void {
  if (_running) return;
  _running = true;

  // runtimeManager → useStore senkronizasyonu
  // Mod değiştiğinde store'u güncelle; bileşenler useStore() ile reactive okur
  _runtimeUnsub = runtimeManager.subscribe((mode) => {
    useStore.getState().setRuntimeMode(mode);
  });

  // Son snapshot'ı geri yükle (5 dk TTL — eski veri güvenilmez)
  const saved = safeGetRaw(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as { level: ThermalLevel; tempC: number | null; ts: number };
      if (Date.now() - parsed.ts < RESTORE_TTL && parsed.level > 0) {
        _level = parsed.level;
        _tempC = parsed.tempC ?? NaN;
        _lastPersistLevel = _level;
        _setCSSLevel(_level);
      }
    } catch { /* bozuk JSON — yoksay */ }
  }

  _subscribeOBD();

  void _pollBatteryAPI();
  _tickTimer = setInterval(() => { void _pollBatteryAPI(); }, POLL_MS);
}

/**
 * Termal watchdog'u durdurur ve tüm kaynakları serbest bırakır.
 * Zero-Leak garantisi.
 */
export function stopThermalWatchdog(): void {
  if (!_running) return;
  _running = false;

  _obdUnsub?.();
  _obdUnsub = null;

  _runtimeUnsub?.();   // Zero-Leak: runtimeManager listener temizle
  _runtimeUnsub = null;

  if (_tickTimer !== null) { clearInterval(_tickTimer); _tickTimer = null; }

  _thermalCallbacks.clear();
  _setCSSLevel(0);

  // State sıfırla
  _level = 0;
  _tempC = NaN;
  _source = 'unknown';
  _injectedPriority = false;
  _savedBrightness  = null;
  _radarWasPaused   = false;
}

/**
 * Native CarLauncher plugin'den CPU/cihaz sıcaklığı enjekte eder.
 * Bu kaynak OBD ve Battery API'ye göre önceliklidir.
 *
 * Kullanım (gelecek native entegrasyon):
 *   CarLauncher.addListener('thermalStatus', e => injectDeviceTemp(e.cpuTempC));
 */
export function injectDeviceTemp(celsius: number): void {
  if (!_running) return;
  _injectedPriority = true;
  _applyTemp(celsius, 'injected');
}

/** Aktif termal seviyeyi döner (0–3). */
export function getThermalLevel(): ThermalLevel {
  return _level;
}

/**
 * L1 veya üzerinde OBD için önerilen poll aralığı (ms).
 * obdService veya başka servisler bu değeri sorgulayabilir.
 * 0 = varsayılan aralık (kısıtlama yok).
 */
export function getThermalOBDInterval(): number {
  return _level >= 1 ? 5_000 : 0;
}

/** Anlık termal snapshot döner (seviye + sıcaklık + kaynak + timestamp). */
export function getThermalSnapshot(): ThermalSnapshot {
  return { level: _level, tempC: _tempC, source: _source, ts: Date.now() };
}

/**
 * Termal seviye değişimlerine abone ol.
 * @returns Aboneliği iptal eden thunk — bileşen unmount'ında çağrılmalı.
 */
export function onThermalLevelChange(cb: ThermalCallback): () => void {
  _thermalCallbacks.add(cb);
  return () => { _thermalCallbacks.delete(cb); };
}

/* ══════════════════════════════════════════════════════════════════════════
   React hook — Dashboard "Termal Uyarı" ikonu için
══════════════════════════════════════════════════════════════════════════ */

function _subscribe(cb: () => void): () => void {
  _storeListeners.add(cb);
  return () => { _storeListeners.delete(cb); };
}

function _getSnap(): ThermalSnapshot { return _storeSnap; }

/**
 * Termal durumu React bileşenlerinde okumak için hook.
 * `level > 0` olduğunda Dashboard'da uyarı ikonu göster.
 *
 * @example
 * const { level, tempC } = useThermalState();
 * if (level >= 2) return <ThermalWarningIcon tempC={tempC} />;
 */
export function useThermalState(): ThermalSnapshot {
  return useSyncExternalStore(_subscribe, _getSnap, _getSnap);
}
