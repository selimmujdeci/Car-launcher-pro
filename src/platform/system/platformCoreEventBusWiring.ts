/**
 * platformCoreEventBusWiring — Platform Event Bus RUNTIME OWNERSHIP (PR-W3).
 *
 * AMAÇ: Uygulamanın TEK `appEventBus` örneğinin SAHİPLİĞİ, oluşturulması, erişimi, temizliği
 * ve boot/shutdown runtime olayları. Bus'ı YARATAN ve DISPOSE EDEN yalnızca bu modüldür.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz):
 *  - `PlatformEventBus`'ın start/stop API'si YOK — yalnız publish/subscribe/reset/dispose.
 *    Bu yüzden "lifecycle" = OLUŞTUR + DISPOSE + tek-instance sahipliği.
 *  - `eventBus` barrel'ı bilinçli olarak GLOBAL SINGLETON EXPORT ETMEZ (import yan etkisiz).
 *    Bu modül o invaryantı KORUR: bus yalnız `start...()` çağrılınca yaratılır; import
 *    edilmesi hiçbir bus oluşturmaz.
 *  - `PlatformKernel` bus'ı `publisher` DI ile TÜKETİR (KernelEventPublisher) → bus Kernel'in
 *    BAĞIMLILIĞIDIR, servisi DEĞİL. Bu yüzden bus'ın sahibi Kernel OLAMAZ; Kernel ileride
 *    `getAppEventBus()` sonucunu DI ile alacak (bu PR'da Kernel'e HİÇ dokunulmaz).
 *  - Publish başarısızlığı SESSİZDİR (`publish()` throw etmez, null döner) → yanlış/disposed
 *    bus'a yayın yapmak sessiz event kaybıdır. Tek-instance guard bu yüzden kritiktir.
 *
 * NE YAPMAZ (bilinçli — PR-W3 yalnız sahiplik/lifecycle'dır):
 *  - Vehicle HAL → Bus bridge BAĞLAMAZ · Capability bridge/Registry BAĞLAMAZ · Deep Scan YOK ·
 *    Platform Kernel'e servis KAYDETMEZ · consumer/abone EKLEMEZ · throttle/debounce YOK ·
 *    HAL stale timer YOK · event kataloğunu GENİŞLETMEZ · legacy event migration YOK ·
 *    yeni timer/polling AÇMAZ · UI/SQL/native DEĞİŞTİRMEZ.
 *
 * RUNTIME OLAYLARI (yalnız MEVCUT katalogdan — yeni ad uydurulmaz):
 *  - `platform.runtime.started` (retained, critical) — TÜM boot dalgaları başarıyla bitince BİR KEZ.
 *  - `platform.runtime.stopped` (critical) — gerçek shutdown'da, bus DISPOSE EDİLMEDEN ÖNCE BİR KEZ.
 *    Yalnız `started` yayınlanmışsa yayınlanır → hiç başlamamış/yarım boot SAHTE `stopped` üretmez.
 *  `source` metadata'sı VERİLMEZ: `PlatformEventSource` beyaz listesinde SystemBoot karşılığı YOK
 *  (foundation'a yeni kaynak eklemek kapsam dışı) → bus varsayılanı `unknown` kalır. Payload YOK
 *  (katalogda payload sözleşmesi yok → alan UYDURULMAZ).
 *
 * SAHİPLİK: bus bu modülündür → `cleanup()` bus'ı DISPOSE EDER. (Bridge'lerin aksine: onlar
 * kaynak sahibi değildir.) Cleanup YALNIZ kendi örneğinin kaydını siler — yabancı/yeni bir
 * wiring'i düşürmez (boot→shutdown→boot güvenli, HMR bayat kaydı serbest bırakılır).
 *
 * FAIL-SOFT: public API dışarı EXCEPTION KAÇIRMAZ; bus oluşturma hatası bir kez `logError` ile
 * kaydedilir ve no-op cleanup döner (boot devam eder). Ham event payload'ı / araç verisi / VIN /
 * koordinat / secret LOGLANMAZ. ZERO-LEAK: timer/abonelik açılmaz; cleanup İDEMPOTENT.
 */

import { logError } from '../crashLogger';
import { createPlatformEventBus, type PlatformEventBus } from '../eventBus';

/** Tek cleanup thunk — İDEMPOTENT + fail-soft. Bus'ın SAHİBİ olduğu için onu dispose EDER. */
export type EventBusWiringCleanup = () => void;

/** Bounded teşhis görünümü — event payload'ı/history içeriği TAŞIMAZ (yalnız sayaçlar). */
export interface EventBusWiringStatus {
  readonly present: boolean;
  readonly disposed: boolean;
  readonly publishedCount: number;
  readonly deliveredCount: number;
  readonly droppedCount: number;
  readonly listenerErrorCount: number;
  readonly duplicateSubscriptionCount: number;
  readonly recursionDropCount: number;
  readonly activeListenerCount: number;
  readonly retainedEventCount: number;
  readonly historyCount: number;
  readonly lastEventAt: number | null;
  readonly runtimeStartedPublished: boolean;
  readonly runtimeStoppedPublished: boolean;
}

const EVENT_RUNTIME_STARTED = 'platform.runtime.started';
const EVENT_RUNTIME_STOPPED = 'platform.runtime.stopped';

const NOOP_CLEANUP: EventBusWiringCleanup = () => { /* no-op */ };

const ABSENT_STATUS: EventBusWiringStatus = Object.freeze({
  present: false,
  disposed: false,
  publishedCount: 0,
  deliveredCount: 0,
  droppedCount: 0,
  listenerErrorCount: 0,
  duplicateSubscriptionCount: 0,
  recursionDropCount: 0,
  activeListenerCount: 0,
  retainedEventCount: 0,
  historyCount: 0,
  lastEventAt: null,
  runtimeStartedPublished: false,
  runtimeStoppedPublished: false,
});

/** Aktif wiring kaydı — modül düzeyinde, ama IMPORT SIRASINDA OLUŞMAZ (yalnız start ile). */
interface ActiveWiring {
  readonly bus: PlatformEventBus;
  startedPublished: boolean;
  stoppedPublished: boolean;
}
let _active: ActiveWiring | null = null;

/** Bayat kayıt (HMR/restart artığı: dispose edilmiş bus) → serbest bırak. */
function _pruneStale(): void {
  if (_active && _active.bus.isDisposed) _active = null;
}

/**
 * Tek `appEventBus` örneğini oluşturur ve SAHİPLENİR. YALNIZ cleanup thunk döner.
 * İDEMPOTENT: aktif bus varken ikinci çağrı YENİ bus YARATMAZ (no-op cleanup döner) →
 * "iki bus / sessiz event kaybı" senaryosu yapısal olarak engellenir.
 * Dışarı exception KAÇIRMAZ.
 */
export function startPlatformCoreEventBusWiring(): EventBusWiringCleanup {
  let active: ActiveWiring | null = null;
  try {
    _pruneStale();
    if (_active) return NOOP_CLEANUP;      // zaten aktif → ikinci bus YOK

    const bus = createPlatformEventBus();  // katalog/limitler foundation varsayılanı (değiştirilmez)
    active = { bus, startedPublished: false, stoppedPublished: false };
    _active = active;

    let disposed = false;
    return () => {
      if (disposed) return;                // İDEMPOTENT
      disposed = true;
      try {
        bus.dispose();                     // bus'ın SAHİBİ bu modül → dispose EDER
      } catch (e) {
        logError('platformEventBusWiring:cleanup', e);   // cleanup hatası shutdown'ı engellemez
      }
      if (active && _active === active) _active = null;  // YALNIZ kendi kaydını siler
    };
  } catch (e) {
    if (active && _active === active) _active = null;    // yarım kayıt bırakma
    logError('platformEventBusWiring:init', e);          // ham payload/araç verisi LOGLANMAZ
    return NOOP_CLEANUP;                                 // boot devam eder (fail-soft)
  }
}

/**
 * Aktif bus'a kontrollü erişim. Bus YOKSA veya DISPOSE EDİLMİŞSE `null` döner —
 * gizlice YENİ bus YARATMAZ (sessiz ikinci-instance riski yok).
 */
export function getAppEventBus(): PlatformEventBus | null {
  _pruneStale();
  return _active ? _active.bus : null;
}

/**
 * `platform.runtime.started` (retained) — TÜM boot dalgaları başarıyla bitince BİR KEZ.
 * Bus yoksa sessizce no-op. Throw ETMEZ.
 */
export function publishRuntimeStarted(): void {
  _pruneStale();
  const a = _active;
  if (!a || a.startedPublished) return;    // çift yayın YOK
  a.startedPublished = true;
  try { a.bus.publishName(EVENT_RUNTIME_STARTED); } catch { /* publish hatası boot'u engellemez */ }
}

/**
 * `platform.runtime.stopped` — shutdown'da, bus DISPOSE EDİLMEDEN ÖNCE BİR KEZ.
 * `started` hiç yayınlanmadıysa (hiç başlamamış / yarım boot) SESSİZ kalır. Throw ETMEZ.
 */
export function publishRuntimeStopped(): void {
  _pruneStale();
  const a = _active;
  if (!a || !a.startedPublished || a.stoppedPublished) return;
  a.stoppedPublished = true;
  try { a.bus.publishName(EVENT_RUNTIME_STOPPED); } catch { /* publish hatası shutdown'ı engellemez */ }
}

/** Bounded teşhis görünümü (payload/history içeriği YOK). Throw ETMEZ. */
export function getEventBusStatus(): EventBusWiringStatus {
  const a = _active;
  if (!a) return ABSENT_STATUS;
  try {
    const s = a.bus.getStats();
    return Object.freeze({
      present: true,
      disposed: a.bus.isDisposed,
      publishedCount: s.publishedCount,
      deliveredCount: s.deliveredCount,
      droppedCount: s.droppedCount,
      listenerErrorCount: s.listenerErrorCount,
      duplicateSubscriptionCount: s.duplicateSubscriptionCount,
      recursionDropCount: s.recursionDropCount,
      activeListenerCount: s.activeListenerCount,
      retainedEventCount: s.retainedEventCount,
      historyCount: s.historyCount,
      lastEventAt: s.lastEventAt,
      runtimeStartedPublished: a.startedPublished,
      runtimeStoppedPublished: a.stoppedPublished,
    });
  } catch {
    return ABSENT_STATUS;   // teşhis yolu asla çökmez
  }
}
