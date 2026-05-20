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
import { setBrightnessAuto,
         setThermalBrightnessLock,
         clearThermalBrightnessLock }                   from './systemSettingsService';
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

// Proactive termal koruma: 35°C'den itibaren FPS throttle başlar
// L0.5 → 35-40°C: erken önleme, kullanıcıya bildirim yok (sessiz)
// L1 → 40-45°C: ısınma başladı, RuntimeEngine FPS throttle
// L2 → 45-55°C: ağır ısı, parlaklık düşürülür
// L3 → 55°C+: kritik, SAFE_MODE + minimum yük

// Giriş eşikleri (°C) — proactive: 35°C'den itibaren FPS throttle
const ENTER: readonly [number, number, number, number] = [35, 40, 45, 55];
// Çıkış eşikleri (°C) — histerezis ile geçiş
const EXIT:  readonly [number, number, number, number] = [32, 38, 42, 52];

// Tahminsel ısı motoru sabitleri
const HISTORY_MAX         = 10;          // Kayar pencere örnekleri (maks)
const HISTORY_SPAN_MS     = 5 * 60_000;  // Pencere genişliği (5 dk)
const PREDICT_HORIZON_MIN = 3.0;         // Kaç dakika ilerisi tahmin edilir
const WORKLOAD_BIAS_C     = 2.5;         // Aktif worker yükü sıcaklık önyargısı (°C)
const EARLY_WARN_REAL_MAX = 42;          // Erken uyarı: gerçek sıcaklık bu altında olmalı

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

// Upward-debounce state: ısınma geçişleri 2 s boyunca sürdürülmedikçe uygulanmaz
let _pendingLevel:  ThermalLevel | null                    = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null   = null;

let _lastBatteryLevel = -1;
let _lastBatteryCheckTs = 0;

// ── Tahminsel ısı motoru state ────────────────────────────────────────────────
interface _ThermalSample { temp: number; ts: number; }
/** Kayar pencere — eğim hesabı için son HISTORY_MAX/HISTORY_SPAN_MS örneği tutar */
const _thermalHistory: _ThermalSample[] = [];
/** Erken uyarı (L0.5) aktif mi? Radar sync'ini sessizce durdurur. */
let _earlyWarningActive      = false;
/** Erken uyarı tarafından durdurulmuş radar sync — L2/L3 flag'inden bağımsız */
let _earlyWarningRadarPaused = false;

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
   Tahminsel ısı motoru — Trend analizi + iş yükü farkındalığı
══════════════════════════════════════════════════════════════════════════ */

/**
 * Sıcaklık örneğini kayar pencereye ekler.
 * Kapasite (HISTORY_MAX) ve zaman penceresi (HISTORY_SPAN_MS) dışındaki örnekler atılır.
 */
function _pushHistory(tempC: number): void {
  const now = Date.now();
  _thermalHistory.push({ temp: tempC, ts: now });
  const cutoff = now - HISTORY_SPAN_MS;
  while (_thermalHistory.length > HISTORY_MAX || (_thermalHistory[0]?.ts ?? Infinity) < cutoff) {
    _thermalHistory.shift();
  }
}

/**
 * Penceredeki ilk ve son örnek arasındaki eğim (°C / dakika).
 * Negatif → soğuma, pozitif → ısınma, 0 → stabil.
 * Pencere çok kısa (<2 örnek veya <10 s) ise 0 döner.
 */
function _calculateSlopeDegPerMin(): number {
  if (_thermalHistory.length < 2) return 0;
  const oldest = _thermalHistory[0];
  const newest = _thermalHistory[_thermalHistory.length - 1];
  const deltaMs = newest.ts - oldest.ts;
  if (deltaMs < 10_000) return 0; // 10s altı pencere güvenilmez
  return ((newest.temp - oldest.temp) / deltaMs) * 60_000;
}

/**
 * Aktif worker'lara göre iş yükü önyargısı (°C).
 * VisionCompute veya NavigationCompute çalışıyorsa +2.5°C ek yük tahmini eklenir.
 */
function _getWorkloadBias(): number {
  const workers = runtimeManager.getWorkers();
  const visionActive = (workers.get('VisionCompute')?.worker ?? null) !== null;
  const navActive    = (workers.get('NavigationCompute')?.worker ?? null) !== null;
  return (visionActive || navActive) ? WORKLOAD_BIAS_C : 0;
}

/**
 * Erken uyarı (L0.5) kontrolü.
 * Tahmin ≥ L1 eşiği (45°C) VE gerçek sıcaklık < 42°C ise
 * arka plan sync'lerini sessizce durdur — kullanıcıya bildirim yok.
 */
function _checkEarlyWarning(predictedTemp: number, realTemp: number): void {
  const shouldWarn = predictedTemp >= ENTER[0] && realTemp < EARLY_WARN_REAL_MAX;

  if (shouldWarn && !_earlyWarningActive) {
    _earlyWarningActive = true;
    if (isCommunitySync()) {
      _earlyWarningRadarPaused = true;
      stopCommunitySync();
    }
    if (import.meta.env.DEV) {
      console.info(
        `[Thermal] EarlyWarn: predicted=${predictedTemp.toFixed(1)}°C ≥ L1 threshold, real=${realTemp.toFixed(1)}°C`,
      );
    }
  } else if (!shouldWarn && _earlyWarningActive) {
    _earlyWarningActive = false;
    // Erken uyarı geçti → sync'i geri başlat (L2/L3 baskısı yoksa)
    if (_earlyWarningRadarPaused && _level < 2) {
      _earlyWarningRadarPaused = false;
      void startCommunitySync();
    } else {
      _earlyWarningRadarPaused = false;
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Histerezis seviye hesabı
══════════════════════════════════════════════════════════════════════════ */

/**
 * Geçerli sıcaklık ve mevcut seviye üzerinden hedef seviyeyi hesaplar.
 * Özyinelemeli çağrı birden fazla seviye düşüşünü tek adımda çözer.
 * 4 seviye: L0(soğuk), L1(ılık), L2(sıcak), L3(kritik)
 */
function _computeLevel(tempC: number, cur: ThermalLevel): ThermalLevel {
  if (!isFinite(tempC)) return 0;

  // Giriş: anında yüksek seviyeye geç (histerezis yok — güvenlik öncelikli)
  if (cur < 3 && tempC >= ENTER[3]) return 3;
  if (cur < 2 && tempC >= ENTER[2]) return 2;
  if (cur < 1 && tempC >= ENTER[1]) return 1;
  if (cur < 0 && tempC >= ENTER[0]) return 0; // L0 proactive giriş

  // Çıkış: histerezis — soğuma eşiği karşılanınca bir alt seviyeye geç
  if (cur === 3 && tempC < EXIT[3]) return _computeLevel(tempC, 2);
  if (cur === 2 && tempC < EXIT[2]) return _computeLevel(tempC, 1);
  if (cur === 1 && tempC < EXIT[1]) return _computeLevel(tempC, 0);
  if (cur === 0 && tempC < EXIT[0]) return 0;

  return cur;
}

/* ══════════════════════════════════════════════════════════════════════════
    RuntimeEngine entegrasyonu — termal seviyeye göre mod zorlaması
══════════════════════════════════════════════════════════════════════════ */

/**
 * Termal seviyeyi RuntimeEngine'e iletir.
 *
 * Erken önleme (L0 proactive):
 *   Sıcaklık 35-40°C arasında → BALANCED mod, FPS throttle 60→30 fps
 *   Böylece ısınma başlamadan önce GPU yükü azaltılır.
 *
 * L1-L3: Mevcut histerezis mantığı korunur.
 *
 * CSS değişkenleri:
 *   --rt-fps-limit: GPU paint throttle (0=limitsiz, 30=30fps, 60=60fps)
 *   --rt-blur: backdrop-filter blur (L2+ kapatılır)
 *   --rt-anim: animasyonlar (L1+ kısılır)
 */
function _notifyRuntime(level: ThermalLevel): void {
  if (level >= 3) {
    // L3: kritik → SAFE_MODE + minimum FPS
    runtimeManager.setMode(RuntimeMode.SAFE_MODE, 'High Temperature');
  } else if (level === 2) {
    // L2: ağır ısı → BASIC_JS + 20fps throttle
    runtimeManager.setMode(RuntimeMode.BASIC_JS, 'thermal-hot');
  } else if (level === 1) {
    // L1: ısınma → BASIC_JS + 30fps throttle
    runtimeManager.setMode(RuntimeMode.BASIC_JS, 'thermal-warm');
  } else {
    // L0 proactive: BALANCED varsayılan, FPS normal
    // 35°C+ giriş yapıldığında erken throttle başlar
    runtimeManager.setMode(RuntimeMode.BALANCED, 'thermal-cool');
  }

  // CSS FPS throttle sinyali — mapService ve diğer bileşenler okur
  const root = document.documentElement;
  if (level >= 2) {
    root.style.setProperty('--rt-fps-limit', '20');
  } else if (level === 1) {
    root.style.setProperty('--rt-fps-limit', '30');
  } else {
    root.style.removeProperty('--rt-fps-limit');
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
  // GPU Guard: HOT (L2) / CRITICAL (L3) → backdrop-filter blur kaldır (%40 GPU yük azalması)
  if (level >= 2) {
    root.classList.add('is-thermal-throttling');
  } else {
    root.classList.remove('is-thermal-throttling');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Seviye geçiş aksiyonları
══════════════════════════════════════════════════════════════════════════ */

function _onEnter(level: ThermalLevel): void {
  _setCSSLevel(level);

  switch (level) {
    case 0:
      // L0 proactive: FPS throttle başladı — sessiz, kullanıcıya bildirim yok
      // mapService zaten `--rt-fps-limit` CSS değişkenini okuyarak throttle yapıyor
      break;

    case 1:
      // L1: FPS throttle aktif (30fps), kullanıcı bildirimi yok
      // Map bileşenleri `--thermal-level` okuyarak ek optimizasyon yapabilir
      break;

    case 2: {
      // Parlaklık %50'ye sabitle (cap ayarlanmadan ÖNCE — termal sistem kendi çağrısı serbest)
      _savedBrightness = useStore.getState().settings.brightness ?? 80;
      setBrightnessAuto(50);
      setThermalBrightnessLock(50); // Kullanıcı %50 üstüne çıkamasın

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
      setBrightnessAuto(30);
      setThermalBrightnessLock(30); // Kullanıcı %30 üstüne çıkamasın

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

  // L3→L2 geçişi: kap L2 seviyesine gevşet (30% → 50%)
  if (fromLevel === 3 && toLevel === 2) {
    setThermalBrightnessLock(50);
  }

  // Parlaklığı geri yükle (L2/L3'ten L0/L1'e düşünce)
  if (fromLevel >= 2 && toLevel < 2 && _savedBrightness !== null) {
    clearThermalBrightnessLock();          // Önce kilidi kaldır — sonra uygula
    setBrightnessAuto(_savedBrightness);   // Sistem geri yüklemesi — manual override takibini tetikleme
    _savedBrightness = null;
  }

  // Radar'ı yeniden başlat (L2/L3'ten L0/L1'e düşünce)
  if (fromLevel >= 2 && toLevel < 2 && _radarWasPaused) {
    _radarWasPaused = false;
    void startCommunitySync();
  }

  // L0'a dönüş: CSS sinyallerini temizle; bildirim gösterilmez (soğuma sessiz).
  if (toLevel === 0) {
    _setCSSLevel(0);
    // FPS throttle kaldırıldı — harita normal 60fps'e döner
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Seviye geçiş koordinatörü
══════════════════════════════════════════════════════════════════════════ */

/**
 * Seviye geçişini uygular, bildirim zincirini ve persistence'ı tetikler.
 * Yalnızca debounce timer'ı veya anlık soğuma aksiyonu tarafından çağrılır.
 */
function _commitLevel(next: ThermalLevel): void {
  const prev = _level;
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
      JSON.stringify({ level: _level, tempC: isFinite(_tempC) ? _tempC : null, ts: Date.now() }),
    );
  }

  // Subscriber bildirimi
  const snap: ThermalSnapshot = { level: _level, tempC: _tempC, source: _source, ts: Date.now() };
  _storeSnap = snap;
  _storeListeners.forEach(l => l());
  _thermalCallbacks.forEach(cb => cb(snap));
}

function _applyTemp(tempC: number, source: ThermalSnapshot['source']): void {
  _tempC  = tempC;
  _source = source;

  // ── Tahminsel ısı motoru ──────────────────────────────────────────────────
  _pushHistory(tempC);
  const slope = _calculateSlopeDegPerMin();

  // Safety Guard: soğuma trendinde tahmin devre dışı (soğumayı geciktirme)
  let predictedTemp: number;
  if (slope < 0) {
    predictedTemp = tempC; // negatif eğim → gerçek sıcaklığı kullan
  } else {
    const workloadBias = _getWorkloadBias();
    predictedTemp = tempC + (slope * PREDICT_HORIZON_MIN) + workloadBias;
  }

  // Erken uyarı (L0.5): tahmin ≥ 45°C ama gerçek < 42°C → sessiz ön-aksiyon
  _checkEarlyWarning(predictedTemp, tempC);

  // Tahmin: L1 geçişi için kullan; L2/L3 için hard limit (ham sıcaklık zorunlu)
  const nextFromPredicted = _computeLevel(predictedTemp, _level);
  const nextFromReal      = _computeLevel(tempC, _level);

  // Karar mantığı:
  //   Soğuma → her zaman gerçek sıcaklık (ani downgrade — güvenlik öncelikli)
  //   L2/L3 yükseltme → gerçek sıcaklık onayı zorunlu (kritik eşikler manipüle edilemesin)
  //   L1 yükseltme → tahmin yeterli (erken müdahale)
  let next: ThermalLevel;
  if (nextFromReal < _level) {
    // Soğuma: gerçek sıcaklık seviyeyi düşürüyor → anında uygula
    next = nextFromReal;
  } else if (nextFromPredicted >= 2) {
    // L2/L3 hard limit: tahmin yeterli değil, gerçek sıcaklık da bu seviyeyi desteklemeli
    next = nextFromReal;
  } else {
    // L0→L1: tahminsel geçiş izin verilir (erken müdahale)
    next = nextFromPredicted;
  }

  // ── Seviye değişmedi ───────────────────────────────────────────────────
  if (next === _level) {
    if (_debounceTimer !== null) { clearTimeout(_debounceTimer); _debounceTimer = null; _pendingLevel = null; }
    return;
  }

  // ── Isınma (next > _level) ────────────────────────────────────────────
  // 2 s sürdürülmesi gerekir (ping-pong önlemi)
  if (next > _level) {
    if (next === _pendingLevel) return;
    if (_debounceTimer !== null) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    _pendingLevel  = next;
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      const target  = _pendingLevel!;
      _pendingLevel = null;
      _commitLevel(target);
    }, 2_000);
    return;
  }

  // ── Soğuma (next < _level) ────────────────────────────────────────────
  // Güvenlik önceliği: soğuma anında uygulanır.
  if (_debounceTimer !== null) { clearTimeout(_debounceTimer); _debounceTimer = null; _pendingLevel = null; }
  _commitLevel(next);
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
    const now          = Date.now();
    const currentLevel = battery.level;

    // İlk çalışma — referans değerleri başlat, bu tik'te karar verme
    if (_lastBatteryLevel === -1) {
      _lastBatteryLevel   = currentLevel;
      _lastBatteryCheckTs = now;
      return;
    }

    // Minimum ölçüm aralığı kontrolü (POLL_MS = 30s)
    const deltaMs = now - _lastBatteryCheckTs;
    if (deltaMs < POLL_MS) return;

    // Fast Charge hızı: şarj varken batarya seviyesi yükseldiyse
    let chargeRatePerMin = 0;
    if (battery.charging && currentLevel > _lastBatteryLevel) {
      chargeRatePerMin = ((currentLevel - _lastBatteryLevel) / deltaMs) * 60_000;
    }

    // L1 tetikleme: hızlı şarj (>%0.5/dk) VEYA kritik düşük batarya + şarj stresi
    if (chargeRatePerMin > 0.005 || battery.level < 0.25) {
      _applyTemp(46, 'battery_heuristic');
    }

    // Ölçüm referansını güncelle
    _lastBatteryLevel   = currentLevel;
    _lastBatteryCheckTs = now;
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

  // Upward-debounce — Zero-Leak: bekleyen timer'ı temizle
  if (_debounceTimer !== null) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  _pendingLevel = null;

  _thermalCallbacks.clear();
  _setCSSLevel(0);

  // State sıfırla
  _level = 0;
  _tempC = NaN;
  _source = 'unknown';
  _injectedPriority    = false;
  _savedBrightness     = null;
  _radarWasPaused      = false;
  // Tahminsel motor sıfırla
  _thermalHistory.length   = 0;
  _earlyWarningActive      = false;
  _earlyWarningRadarPaused = false;
}

/**
 * Native CarLauncher plugin'den CPU/cihaz sıcaklığı enjekte eder.
 * Bu kaynak OBD ve Battery API'ye göre önceliklidir.
 *
 * Kullanım (gelecek native entegrasyon):
 *   CarLauncher.addListener('thermalStatus', e => injectDeviceTemp(e.cpuTempC));
 */
export function injectDeviceTemp(celsius: number): void {
  // DEV modda native platform'da bile enjeksiyon izni (senaryo testi için)
  if (!_running && !import.meta.env.DEV) return;
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
