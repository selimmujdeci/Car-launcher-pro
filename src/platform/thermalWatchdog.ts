/**
 * thermalWatchdog.ts — Shield Thermal Management
 *
 * Periyodik sıcaklık okuma (30s), kademeli kısıtlama ve self-healing soğuma.
 *
 * Sıcaklık kaynakları (öncelik sırasıyla):
 *   1. SoC die (sysfs, native readThermal) — AYRI ölçek, aşağıya bak
 *   2. injectDeviceTemp() — kaos/test enjeksiyonu
 *   3. OBD batteryTemp   — EV akü paketi (araç içi sıcaklık proxy)
 *   4. Battery API       — şarj durumu heuristic (sıcaklık yoksa)
 *   NOT (2026-06-11): OBD engineTemp kaynak DEĞİLDİR — motor suyu (90-105°C)
 *   cihaz ısısı sanılıp head unit'i kalıcı L2/L3 kısıtlamaya sokuyordu.
 *   NOT (2026-07-27): AYNI TUZAK sysfs için de geçerli — SoC die sıcaklığı bu
 *   SoC'de boşta 73-79 °C, yük altında 82-94 °C'dir. Ham die değeri aşağıdaki
 *   KASA kademelerine beslenirse cihaz KALICI L3'e düşer (parlaklık %30 +
 *   minimum yük modu). Bu yaşandı ve geri alındı: die kaynağı KENDİ eşiklerini
 *   (SOC_DIE_L1/L2/L3 = 100/105/110 °C) kullanır ve yalnız o bölgede müdahale eder.
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
import { isNative }                                     from './bridge';
import { CarLauncher }                                  from './nativePlugin';
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

/* ── SoC ÇEKİRDEK (die) kademeleri — KASA eşiklerinden AYRI ölçek ──────────
 * Aynı cihazda ölçüldü (kütük #139/#141): boşta 73-79 °C, yük altında 82-94 °C.
 * Eşikler bu NORMAL aralığın üstünden başlar → yanlış kısıtlama yapılmaz. */
const SOC_DIE_L1  = 100;         // °C — die uyarı
const SOC_DIE_L2  = 105;         // °C — die sıcak
const SOC_DIE_L3  = 110;         // °C — die kritik
const SOC_DIE_HYST = 3;          // °C — serbest bırakma payı

/* Die kademesini PAYLAŞILAN kasa ölçeğine eşleyen temsilci değerler. */
const SCALE_L0    = 30;
const SCALE_L1    = 46;
const SCALE_L2    = 56;
const SCALE_L3    = 66;
const STORAGE_KEY = 'tw-state';  // safeStorage anahtarı
const RESTORE_TTL = 5 * 60_000;  // Eski snapshot'ı yoksay (5 dk)

// Giriş / Çıkış eşikleri — 5°C histerezis bandı
const ENTER: readonly [number, number, number] = [45, 55, 65];
const EXIT:  readonly [number, number, number] = [40, 50, 60];

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
/** Son HAM SoC die okuması (°C). NaN = hiç okunmadı. */
let _socDieTempC: number = NaN;
/** Kademeyi die kaynağı mı yükseltti — yalnız kendi kararımızı geri alırız. */
let _socEscalated = false;
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
    case 1:
      // L1: CSS var seti yeterli.
      // Map bileşenleri `--thermal-level` okuyarak FPS'yi kısıtlar.
      // OBD servisi `getThermalLevel()` ile poll aralığını ayarlayabilir.
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

  // Parlaklığı geri yükle (L2/L3'ten L1 veya L0'a düşünce)
  if (fromLevel >= 2 && toLevel < 2 && _savedBrightness !== null) {
    clearThermalBrightnessLock();          // Önce kilidi kaldır — sonra uygula
    setBrightnessAuto(_savedBrightness);   // Sistem geri yüklemesi — manual override takibini tetikleme
    _savedBrightness = null;
  }

  // Radar'ı yeniden başlat (L2/L3'ten L1 veya L0'a düşünce)
  if (fromLevel >= 2 && toLevel < 2 && _radarWasPaused) {
    _radarWasPaused = false;
    void startCommunitySync();
  }

  // L0'a dönüş: CSS sinyalini kaldır; bildirim gösterilmez (soğuma sessiz).
  // L2/L3 uyarısı kullanıcıya zaten gösterilmişti; her soğuma için tekrar
  // "Normal" toast'u dikkat dağıtıcı olduğundan kaldırıldı.
  if (toLevel === 0) {
    _setCSSLevel(0);
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
    }
    // PERF/DOĞRULUK 2026-06-11: engineTemp ZİNCİRDEN ÇIKARILDI. Motor soğutma
    // suyu (ICE normalde 90-105°C) CİHAZIN sıcaklığı değildir — L1 eşiği 45°C
    // olduğundan her sağlıklı motor head unit'i kalıcı L2/L3 termal kısıtlamaya
    // sokuyor, FPS/işlev kısıtları "10 sn kilitlenme" olarak yaşanıyordu.
    // Cihaz ısısı kaynakları: injectDeviceTemp (native) + batteryTemp (EV paketi
    // proxy) + Battery API heuristic. Motor sıcaklığı yalnız gösterge/uyarı
    // katmanlarının işidir (companionContext.interpretEngineTempConcern vb.).
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Sıcaklık okuma — Battery API (30s periyodik)
══════════════════════════════════════════════════════════════════════════ */

/**
 * _pollNativeThermal — cihazın sysfs termal bölgelerinden GERÇEK CPU sıcaklığı okur.
 *
 * NEDEN VAR (saha kanıtı, kütük #139 · DEBT-013): Bu güç sınıfındaki head unit'lerde
 * Android termal HAL ÖLÜ (`HAL Ready: false`) ve `injectDeviceTemp()` üretimde HİÇ
 * çağrılmıyordu → `thermalWatchdog` `source:'unknown'`da kalıyor, cihaz 93 °C'ye
 * çıkarken L1/L2/L3 eşikleri hiç tetiklenmiyordu. Tek okunabilir kaynak sysfs'tir.
 *
 * FAIL-CLOSED: native yoksa, çağrı düşerse veya hiçbir bölge okunamazsa **hiçbir şey
 * yapılmaz** — sıcaklık TAHMİN EDİLMEZ, mevcut kaynak (OBD/battery) bozulmaz.
 * Yeni timer AÇMAZ; mevcut 30 sn'lik tick'e biner.
 */
/* ══════════════════════════════════════════════════════════════════════════
 * SAF yardımcılar (SoC die) — I/O yok, modül durumu yok → tam test edilebilir.
 * ════════════════════════════════════════════════════════════════════════ */

/** `readThermal()` bölgesinin test edilebilir dar görünümü. */
export interface ThermalZoneLike { readonly type?: string; readonly tempC?: number }

/**
 * Bir sysfs bölge etiketi SoC ÇEKİRDEK (die) sınıfı mı?
 *
 * ZERO-TRUST: yalnız AÇIKÇA die/işlemci olduğunu söyleyen etiketler kabul edilir.
 * `battery` · `ambient` · `board` · `case` · `pmic` · `charger` gibi KASA/ÇEVRE
 * sensörleri farklı ölçektedir; die eşikleriyle (100/105/110 °C) değerlendirilirse
 * gerçek aşırı ısınma KAÇIRILIR. Etiket yoksa veya tanınmıyorsa `false` — bölge
 * UNAVAILABLE sayılır, TAHMİN EDİLMEZ.
 */
export function isDieZone(type: string | undefined): boolean {
  if (typeof type !== 'string' || type.length === 0) return false;
  const t = type.toLowerCase();
  // Önce dışlama: kasa/çevre/güç sensörleri asla die değildir.
  if (/batt|ambient|board|case|skin|pmic|charger|usb|modem|wifi|bms/.test(t)) return false;
  return /cpu|soc|die|gpu|ddr|thermal_zone_?(cpu|gpu)|tsens|bigcore|littlecore/.test(t);
}

/**
 * Okunabilir die bölgeleri arasından EN SICAK olanı seçer.
 * Die sınıfı bölge yoksa `null` — etiketsiz bölge die YERİNE GEÇMEZ.
 */
export function selectDieTempC(zones: readonly ThermalZoneLike[] | undefined): number | null {
  if (!Array.isArray(zones)) return null;
  let best: number | null = null;
  for (const z of zones) {
    if (typeof z?.tempC !== 'number' || !Number.isFinite(z.tempC)) continue;
    if (!isDieZone(z.type)) continue;
    if (best === null || z.tempC > best) best = z.tempC;
  }
  return best;
}

/**
 * Die sıcaklığını KENDİ kademesine çevirir (kasa ölçeğinden AYRI).
 * `prevLevel` verilirse serbest bırakmada histerezis uygulanır.
 */
export function dieLevelFor(tempC: number, prevLevel: ThermalLevel = 0): ThermalLevel {
  if (!Number.isFinite(tempC)) return 0;
  if (tempC >= SOC_DIE_L3) return 3;
  if (tempC >= SOC_DIE_L2) return 2;
  if (tempC >= SOC_DIE_L1) return 1;
  // Histerezis: yükselttiysek, eşiğin SOC_DIE_HYST altına inene dek bırakma.
  if (prevLevel > 0 && tempC >= SOC_DIE_L1 - SOC_DIE_HYST) return prevLevel;
  return 0;
}

async function _pollNativeThermal(): Promise<void> {
  if (!isNative) return;
  try {
    const res = await CarLauncher.readThermal();
    if (!res?.available || !Array.isArray(res.zones)) return;

    const die = selectDieTempC(res.zones);
    if (die === null) return;   // die sınıfı sensör okunamadı → UNAVAILABLE, sessiz çık
    _socDieTempC = die;         // gözlem için HAM değer daima saklanır

    /* ── ÖLÇEK KAPISI (kritik) ────────────────────────────────────────────────
     * Bu dosyanın kademeleri (L1 45 · L2 55 · L3 65 °C) KASA/ORTAM sıcaklığı
     * içindir. sysfs ise SoC ÇEKİRDEK (die) sıcaklığı verir — tamamen başka bir
     * ölçek. Ham die değerini doğrudan beslemek, 2026-06-11'de motor suyu
     * (90-105 °C) için düzeltilen hatanın AYNISINI üretir: cihaz kalıcı L3'e
     * düşer (parlaklık %30 + minimum yük modu). 2026-07-27'de tam olarak bu
     * yaşandı ve geri alındı.
     *
     * KALİBRASYON (uydurma DEĞİL — aynı cihazda ölçüldü, kütük #139/#141):
     *   uygulama KAPALI : 73–79 °C   → bu SoC için NORMAL boşta
     *   uygulama AÇIK   : 82–94 °C   → NORMAL yük altı
     * Bu yüzden die kademeleri gözlenen normal aralığın ÜSTÜNDEN başlar.
     * Aşağıdaki eşiklerin altında die kaynağı watchdog'a HİÇ DOKUNMAZ —
     * OBD/battery kaynağını ezmez.
     */
    const prev: ThermalLevel = _socEscalated ? _level : 0;
    const nextLevel: ThermalLevel = dieLevelFor(die, prev);

    if (nextLevel === 0) {
      // Yalnız BİZ yükselttiysek serbest bırak (histerezis payıyla) — başka
      // kaynağın kararını sıfırlamayız.
      if (_socEscalated) {
        _socEscalated = false;
        _injectedPriority = false;
        _applyTemp(SCALE_L0, 'injected');
      }
      return;
    }

    // Die tehlike bölgesinde: kademeyi PAYLAŞILAN ölçeğe eşleyerek uygula.
    // Not: burada `_tempC` eşlenmiş değeri gösterir; HAM die için
    // `getSocDieTempC()` kullanılır (gözlemlenebilirlik ayrı tutulur).
    _socEscalated = true;
    _injectedPriority = true;
    _applyTemp(nextLevel === 3 ? SCALE_L3 : nextLevel === 2 ? SCALE_L2 : SCALE_L1, 'injected');
  } catch {
    /* fail-soft: native yok / metot yok / okuma reddedildi → kaynak değişmez */
  }
}

/** Son okunan HAM SoC die sıcaklığı (°C) — eşlenmiş değer değil. NaN = okunmadı. */
export function getSocDieTempC(): number {
  return _socDieTempC;
}

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

  void _pollNativeThermal();
  void _pollBatteryAPI();
  // YENİ TIMER AÇILMADI: native termal okuma MEVCUT 30 sn'lik tick'e biner.
  _tickTimer = setInterval(() => {
    void _pollNativeThermal();
    void _pollBatteryAPI();
  }, POLL_MS);
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
