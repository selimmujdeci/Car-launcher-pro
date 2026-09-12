/**
 * backgroundPowerGate — arka plan güç politikasının TEK uygulama noktası (wiring).
 *
 * Saf karar `backgroundPowerModel.decideBackgroundPower` tarafından üretilir;
 * bu dosya yalnız girdileri toplar ve kararı iki mevcut servise uygular:
 *   · `gpsService.applyGpsPowerMode`            — JS konum akışı güç modu
 *   · `wakeWordService.pause/resumeWakeWordForPower` — pasif mikrofon
 *
 * ── SÖZLEŞME — bu kapı NE YAPMAZ ─────────────────────────────────────────
 *   · Yeni konum/mikrofon akışı BAŞLATMAZ — yalnız var olanın modunu değiştirir.
 *   · İzin İSTEMEZ, ağ çağrısı YAPMAZ, timer KURMAZ (olay-güdümlü).
 *   · Kullanıcı ayarını (wake açık/kapalı) DEĞİŞTİRMEZ.
 *   · Head unit davranışını DEĞİŞTİRMEZ: harici güç varken karar 'foreground'
 *     ile aynı çıkar (bkz. model, `external_power` dalı).
 *   · Navigasyon sürerken hiçbir şeyi kısmaz.
 *
 * Fail-soft: her abonelik kendi try/catch'inde; biri kurulamazsa diğerleri
 * çalışmaya devam eder, kapı hiç kurulamazsa ÜRÜN DAVRANIŞI ESKİSİ GİBİ kalır.
 */
import { logError } from '../crashLogger';
import { applyGpsPowerMode } from '../gpsService';
import { setNavPowerObserver } from '../navigation/navGpsPowerBridge';
import {
  getWakeWordState,
  pauseWakeWordForPower,
  resumeWakeWordForPower,
} from '../wakeWordService';
import {
  decideBackgroundPower,
  isSameDecision,
  type BackgroundPowerDecision,
  type BackgroundPowerInputs,
} from './backgroundPowerModel';

/** Capacitor `appStateChange` okunamadıysa `null` kalır (model ön plan varsayar). */
let _appActive: boolean | null = null;
/** Battery API okunamadıysa `null` kalır (model mikrofona dokunmaz). */
let _externalPower: boolean | null = null;
/** Navigasyon oturumu — `navGpsPowerBridge` tek bildirim noktasıdır. */
let _navigationActive = false;

/** Son UYGULANAN karar — aynı karar tekrar uygulanmaz (donanım thrash'i yok). */
let _lastApplied: BackgroundPowerDecision | null = null;
/**
 * Son kararın UYGULANDIĞI an (Unix ms). `null` = hiç uygulanmadı.
 *
 * Neden var: tanı ekranında "karar var ama ne zamandan beri?" sorusu kanıtsız
 * kalıyordu. Damgasız alan için yaş HESAPLANAMAZ (sahte tarih yasağı) — bu yüzden
 * damga ÜRETİLİR, uydurulmaz. Timer DEĞİLDİR: yalnız uygulama anında yazılır.
 */
let _lastAppliedAt: number | null = null;
/** Kaç kez FARKLI karar uygulandı — sahada "kapı hiç kımıldamadı" ayrımı için. */
let _appliedCount = 0;

let _started = false;

/**
 * Harici güç durumunu NATIVE kaynaktan tazeler ve değiştiyse yeniden değerlendirir.
 *
 * Neden native: `navigator.getBattery()` WebView'de gizlilik gerekçesiyle sabit
 * `charging: true` döndürebilir; o hâlde kapı hiçbir zaman kısma kararı üretmez
 * (sahada 2026-08-20 böyle gözlendi: telefon pille çalışırken JS konum isteği
 * `@+10s HIGH_ACCURACY` olarak kaldı). `CarLauncher.getDeviceStatus()` Android
 * `BatteryManager.EXTRA_STATUS` okur — tek güvenilir kaynak.
 * Fail-soft: okunamazsa `null` bırakılır — model muhafazakâr davranır.
 */
export async function refreshExternalPower(): Promise<void> {
  let next: boolean | null = null;
  try {
    const { CarLauncher } = await import('../nativePlugin');
    const status = await CarLauncher.getDeviceStatus();
    if (status && typeof status.charging === 'boolean') next = status.charging;
  } catch {
    next = null;                 // web/demo veya köprü yok → bilinmiyor
  }
  if (next === _externalPower) { reevaluateBackgroundPower(); return; }
  _externalPower = next;
  reevaluateBackgroundPower();
}

/** Anlık girdi görüntüsü — karar bu görüntüden üretilir. */
function _inputs(): BackgroundPowerInputs {
  let wakeWordEnabled = false;
  try { wakeWordEnabled = getWakeWordState().enabled === true; }
  catch { /* fail-soft: okunamadıysa kapalı say — model mikrofonu AÇTIRMAZ */ }

  return {
    appActive:        _appActive,
    navigationActive: _navigationActive,
    externalPower:    _externalPower,
    wakeWordEnabled,
  };
}

/**
 * Girdileri okur, kararı üretir ve DEĞİŞTİYSE uygular.
 * İdempotent; dışarıdan da çağrılabilir (girdi değişiminde tetiklenir).
 */
export function reevaluateBackgroundPower(): void {
  if (!_started) return;

  const decision = decideBackgroundPower(_inputs());
  if (isSameDecision(_lastApplied, decision)) return;
  _lastApplied = decision;
  _lastAppliedAt = Date.now();
  _appliedCount++;

  try {
    void applyGpsPowerMode(decision.gps);
  } catch (e) { logError('BgPower:gps', e); }

  try {
    if (decision.mic === 'off') pauseWakeWordForPower();
    else                        resumeWakeWordForPower();
  } catch (e) { logError('BgPower:mic', e); }
}

/**
 * Navigasyon oturumunun canlılığını bildirir — `navGpsPowerBridge`'in JS ikizi.
 * Tek yönlüdür: kapı navigasyon modüllerini İMPORT ETMEZ (döngü yok).
 */
export function notifyNavigationActiveForPower(active: boolean): void {
  const next = active === true;
  if (next === _navigationActive) return;
  _navigationActive = next;
  reevaluateBackgroundPower();
}

/** Tanı/LAB için salt-okunur görüntü — hüküm içermez, ham girdi + son karar. */
export interface BackgroundPowerSnapshot {
  readonly started: boolean;
  readonly inputs: BackgroundPowerInputs;
  readonly lastApplied: BackgroundPowerDecision | null;
  /** Son kararın uygulandığı an (Unix ms) — `null` = hiç uygulanmadı (yaş HESAPLANMAZ). */
  readonly lastAppliedAt: number | null;
  /** Kaç kez farklı karar uygulandı. 0 = kapı hiç kımıldamadı. */
  readonly appliedCount: number;
}

export function getBackgroundPowerSnapshot(): BackgroundPowerSnapshot {
  return {
    started: _started,
    inputs: _inputs(),
    lastApplied: _lastApplied,
    lastAppliedAt: _lastAppliedAt,
    appliedCount: _appliedCount,
  };
}

/**
 * Kapıyı kurar. İdempotent değildir — SystemBoot tek kez çağırır ve dönen
 * cleanup'ı LIFO stack'ine kaydeder (zero-leak).
 */
export function startBackgroundPowerGate(): () => void {
  if (_started) return () => { /* çift kurulum yok */ };
  _started = true;

  const cleanups: Array<() => void> = [];

  // ── 0. Navigasyon canlılığı ──────────────────────────────────────────────
  // Köprü bizi İMPORT ETMEZ; biz ona kaydoluruz (tek yönlü bağımlılık →
  // navigasyon testleri bu kapının bağımlılık zincirini yüklemez).
  try {
    setNavPowerObserver(notifyNavigationActiveForPower);
    cleanups.push(() => setNavPowerObserver(null));
  } catch (e) {
    logError('BgPower:navObserver', e);
  }

  // ── 1. Uygulama ön/arka plan durumu ──────────────────────────────────────
  void import('@capacitor/app')
    .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
      _appActive = isActive === true;
      void refreshExternalPower();          // güç, activity duraklamışken değişmiş olabilir
    }))
    .then((handle) => {
      if (!_started) { handle.remove(); return; }   // kurulum sırasında kapandıysa
      cleanups.push(() => { try { handle.remove(); } catch { /* ignore */ } });
    })
    .catch((e: unknown) => logError('BgPower:appState', e));

  // ── 2. Görünürlük yedeği ─────────────────────────────────────────────────
  // `appStateChange` tek dayanak DEĞİLDİR: ekran kapanınca WebView her hâlükârda
  // `visibilitychange` yayınlar. İki kaynak da aynı bayrağı yazar (idempotent).
  try {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVisibility = () => {
        _appActive = document.visibilityState === 'visible';
        void refreshExternalPower();
      };
      document.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => {
        try { document.removeEventListener('visibilitychange', onVisibility); }
        catch { /* ignore */ }
      });
      onVisibility();                        // ilk okuma
    }
  } catch (e) {
    logError('BgPower:visibility', e);
  }

  // ── 3. Harici güç (şarj) durumu — NATIVE kaynak ──────────────────────────
  // Web Battery API (`navigator.getBattery`) BİLEREK kullanılmaz: WebView'de
  // gizlilik gerekçesiyle sabit `charging: true` döndürebilir ve o hâlde kapı
  // asla kısma kararı üretmez (sahada 2026-08-20 böyle gözlendi — telefon pille
  // çalışırken JS isteği `@+10s HIGH_ACCURACY` olarak kaldı). Native
  // `getDeviceStatus()` `BatteryManager.EXTRA_STATUS` okur — tek doğru kaynak.
  void refreshExternalPower();

  // İlk değerlendirme: ön planda + kısma yok → mevcut davranışla birebir aynı.
  reevaluateBackgroundPower();

  return () => {
    _started = false;
    for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
    cleanups.length = 0;
    // Kapı kapanırken kısma BIRAKILMAZ: tam güce dön (kapalı kapı kısıtlamaz).
    try { void applyGpsPowerMode('high'); } catch { /* ignore */ }
    try { resumeWakeWordForPower(); } catch { /* ignore */ }
    _lastApplied = null;
    _lastAppliedAt = null;
    _appActive = null;
    _externalPower = null;
    _navigationActive = false;
  };
}

/** @internal — testler arası izolasyon. */
export function _resetBackgroundPowerGateForTest(): void {
  _started = false;
  _lastApplied = null;
  _lastAppliedAt = null;
  _appliedCount = 0;
  _appActive = null;
  _externalPower = null;
  _navigationActive = false;
}

/** @internal — testte girdileri doğrudan sürmek için. */
export function _setBackgroundPowerInputsForTest(patch: {
  appActive?: boolean | null;
  externalPower?: boolean | null;
  navigationActive?: boolean;
  started?: boolean;
}): void {
  if ('appActive' in patch)        _appActive        = patch.appActive ?? null;
  if ('externalPower' in patch)    _externalPower    = patch.externalPower ?? null;
  if ('navigationActive' in patch) _navigationActive = patch.navigationActive === true;
  if ('started' in patch)          _started          = patch.started === true;
}
