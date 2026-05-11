/**
 * ScenarioEngine — Otomotiv Senaryo Test Motoru (DEV ONLY)
 *
 * Production APK'da erişilemez:
 *   • Her public fonksiyon import.meta.env.DEV kontrolü ile korunur
 *   • Vite production build'de tüm `if (false)` blokları tree-shaked edilir
 *
 * Senaryo türleri:
 *   tunnel-escape  — GPS kayıp → Dead Reckoning → Jump Guard
 *   overheat       — L0 → L2 termal → L3 kritik → Kurtarma
 *   obd-fault      — OBD bağlantı kesilmesi ve yeniden bağlanma
 */

import { setGPSTestOverride }       from '../gpsService';
import { setOBDTestOverride }       from '../obdService';
import { injectDeviceTemp }         from '../thermalWatchdog';
import { startDeadReckoningGuard }  from '../gpsService';
import type { GPSLocation }         from '../vehicleDataLayer/types';

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface ScenarioStep {
  t:       number;    // ms — senaryo başlangıcından itibaren gecikme
  label:   string;    // HUD'da görünecek açıklama
  action:  () => void;
}

export interface AutomotiveScenario {
  name:        string;
  description: string;
  steps:       ScenarioStep[];
}

export interface ScenarioState {
  running:       boolean;
  scenarioName:  string | null;
  currentStep:   number;
  totalSteps:    number;
  elapsedMs:     number;
  lastLabel:     string;
}

/* ── Built-in scenarios ───────────────────────────────────────────────────── */

/** Türkiye orta koordinatı — senaryo testi için sabit referans noktası. */
const _BASE_LOC: GPSLocation = {
  latitude:  39.925533,
  longitude: 32.866287,
  accuracy:  5,
  timestamp: 0,
};

/**
 * Tünel Kaçış Senaryosu:
 *   T=0s   : Normal GPS (temiz)
 *   T=5s   : GPS sinyal kaybı (null konum enjekte)
 *   T=15s  : Dead Reckoning tetikle
 *   T=35s  : Yüksek hata ile GPS kurtarma → Jump Guard tetikler
 */
export const TUNNEL_ESCAPE_SCENARIO: AutomotiveScenario = {
  name:        'tunnel-escape',
  description: 'GPS Kayıp → Dead Reckoning → Yüksek Hatarla GPS Kurtarma',
  steps: [
    {
      t:      0,
      label:  'T=0s: GPS Normal',
      action: () => {
        setGPSTestOverride(null);          // Gerçek GPS'e dön
        setOBDTestOverride(null);
      },
    },
    {
      t:      5_000,
      label:  'T=5s: GPS Sinyal Kaybı',
      action: () => {
        setGPSTestOverride({
          location:   null,
          isTracking: false,
          source:     null,
          error:      'GPS: Sinyal kayboldu (tünel senaryosu)',
        });
      },
    },
    {
      t:      15_000,
      label:  'T=15s: Dead Reckoning Aktif',
      action: () => {
        // DR guard mevcut OBD hızını kullanarak tahmin yapmaya başlar
        startDeadReckoningGuard();
      },
    },
    {
      t:      35_000,
      label:  'T=35s: GPS Kurtarma (Yüksek Hata → Jump Guard)',
      action: () => {
        // Baz konumdan 500m+ atlayış → JumpGuard devreye girer
        setGPSTestOverride({
          location: {
            ..._BASE_LOC,
            latitude:  _BASE_LOC.latitude  + 0.008,  // ~890m kuzey
            longitude: _BASE_LOC.longitude + 0.005,  // ~415m doğu
            accuracy:  120,                           // düşük kalite
          },
          isTracking: true,
          source:     'native',
          error:      null,
        });
        // 3 saniye sonra temizle — JumpGuard'ın reddedip kararlaşacağı süre
        setTimeout(() => setGPSTestOverride(null), 3_000);
      },
    },
  ],
};

/**
 * Aşırı Isınma Senaryosu:
 *   T=0s  : Normal sıcaklık (40°C)
 *   T=3s  : L1 Uyarı (65°C)
 *   T=6s  : L2 Sıcak (75°C)
 *   T=9s  : L3 Kritik (90°C)
 *   T=20s : Kurtarma (38°C)
 */
export const OVERHEAT_SCENARIO: AutomotiveScenario = {
  name:        'overheat',
  description: 'Termal L0→L3 yükseliş ve sistem kısıtlaması',
  steps: [
    { t: 0,      label: 'T=0s: Normal (40°C)',   action: () => injectDeviceTemp(40) },
    { t: 3_000,  label: 'T=3s: L1 Uyarı (65°C)', action: () => injectDeviceTemp(65) },
    { t: 6_000,  label: 'T=6s: L2 Sıcak (75°C)', action: () => injectDeviceTemp(75) },
    { t: 9_000,  label: 'T=9s: L3 Kritik (90°C)', action: () => injectDeviceTemp(90) },
    { t: 20_000, label: 'T=20s: Soğuma (38°C)',   action: () => injectDeviceTemp(38) },
  ],
};

/**
 * OBD Bağlantı Kesilmesi Senaryosu:
 *   T=0s : Bağlı, gerçek veri
 *   T=3s : OBD koptu (speed=0, source=none, connectionState=disconnected)
 *   T=10s: Yeniden bağlandı
 */
export const OBD_FAULT_SCENARIO: AutomotiveScenario = {
  name:        'obd-fault',
  description: 'OBD bağlantı kesintisi ve yeniden bağlanma',
  steps: [
    {
      t:      0,
      label:  'T=0s: OBD Bağlı',
      action: () => setOBDTestOverride(null),
    },
    {
      t:      3_000,
      label:  'T=3s: OBD Bağlantı Kesildi',
      action: () => setOBDTestOverride({
        connectionState: 'error',
        source:          'none',
        speed:           0,
        rpm:             -1,
        fuelLevel:       -1,
      }),
    },
    {
      t:      10_000,
      label:  'T=10s: OBD Yeniden Bağlandı',
      action: () => setOBDTestOverride(null),
    },
  ],
};

export const BUILT_IN_SCENARIOS: AutomotiveScenario[] = [
  TUNNEL_ESCAPE_SCENARIO,
  OVERHEAT_SCENARIO,
  OBD_FAULT_SCENARIO,
];

/* ── Engine state ─────────────────────────────────────────────────────────── */

let _running       = false;
let _scenario:     AutomotiveScenario | null = null;
let _timers:       ReturnType<typeof setTimeout>[] = [];
let _startTime     = 0;
let _currentStep   = 0;
let _stateListeners = new Set<(s: ScenarioState) => void>();

/* ── State emission ───────────────────────────────────────────────────────── */

function _emitState(label = ''): void {
  const s: ScenarioState = {
    running:      _running,
    scenarioName: _scenario?.name ?? null,
    currentStep:  _currentStep,
    totalSteps:   _scenario?.steps.length ?? 0,
    elapsedMs:    _running ? Date.now() - _startTime : 0,
    lastLabel:    label,
  };
  _stateListeners.forEach((fn) => fn(s));
}

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * Senaryo yürütmeyi başlatır. DEV only — production'da no-op.
 */
export function startScenario(scenario: AutomotiveScenario): void {
  if (!import.meta.env.DEV) return;

  stopScenario(); // Önceki senaryo varsa durdur

  _scenario    = scenario;
  _running     = true;
  _startTime   = Date.now();
  _currentStep = 0;
  _timers      = [];

  console.info(`[ScenarioEngine] Başlıyor: "${scenario.name}"`);

  scenario.steps.forEach((step, idx) => {
    const tid = setTimeout(() => {
      if (!_running) return;
      _currentStep = idx + 1;
      console.info(`[ScenarioEngine] ${step.label}`);
      try { step.action(); } catch (e) { console.error('[ScenarioEngine] Adım hatası:', e); }
      _emitState(step.label);

      // Son adım tamamlandı
      if (idx === scenario.steps.length - 1) {
        _running = false;
        _emitState('Senaryo tamamlandı');
        console.info(`[ScenarioEngine] "${scenario.name}" tamamlandı.`);
      }
    }, step.t);

    _timers.push(tid);
  });

  _emitState('Başladı');
}

/**
 * Aktif senaryoyu durdurur, tüm override'ları sıfırlar.
 */
export function stopScenario(): void {
  if (!import.meta.env.DEV) return;

  _timers.forEach((tid) => clearTimeout(tid));
  _timers    = [];
  _running   = false;

  // Override'ları temizle
  setGPSTestOverride(null);
  setOBDTestOverride(null);

  _emitState('Durduruldu');
  console.info('[ScenarioEngine] Durduruldu.');
}

export function isScenarioRunning(): boolean { return _running; }

export function getScenarioState(): ScenarioState {
  return {
    running:      _running,
    scenarioName: _scenario?.name ?? null,
    currentStep:  _currentStep,
    totalSteps:   _scenario?.steps.length ?? 0,
    elapsedMs:    _running ? Date.now() - _startTime : 0,
    lastLabel:    '',
  };
}

/** Senaryo durum değişikliklerine abone ol. */
export function onScenarioState(fn: (s: ScenarioState) => void): () => void {
  _stateListeners.add(fn);
  return () => _stateListeners.delete(fn);
}
