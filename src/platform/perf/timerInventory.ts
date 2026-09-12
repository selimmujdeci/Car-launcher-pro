/**
 * timerInventory — ARCH-06/F1 · TİMER ENVANTERİ (SAF METADATA · OTORİTE DEĞİL).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **ZAMANLAYICI DEĞİLDİR.** Hiçbir timer kurmaz, durdurmaz, hızını
 *     değiştirmez. Bir descriptor'ı okumak bir davranış üretmez.
 * (2) **MERKEZÎ TIMER SERVİSİ DEĞİLDİR.** F0 kararı: alan sahibi kendi
 *     timer'ının sahibi KALIR. Burada yalnız "kim, hangi sınıf, ne sıklıkta,
 *     esneyebilir mi" yazılıdır.
 * (3) **GLOBAL MONKEYPATCH YOK.** `setInterval`/`setTimeout` sarmalanmaz.
 *     Sarmalamak, ölçülen sistemin davranışını değiştirmek olurdu ve her
 *     bileşen timer'ını da kirletirdi.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN STATİK BİLDİRİM ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F0 ölçtü: platform/core/store/hooks katmanında **72 ham `setInterval`**
 * var ve yalnız **12** görev ARM tik-wheel'inde. Yani düşük-uçlu bir head
 * unit'te `RuntimeMode` düşse bile o 72 timer aynı hızda döner.
 *
 * F2'nin (migration) yapabilmesi için önce **tam liste** gerekir. Bu dosya o
 * listedir: her uzun ömürlü tekrarlayan timer BİLDİRİLİR, sınıflandırılır ve
 * F2 kararı (`KEEP` / `MIGRATE` / `DEFER` / `DELETE`) yazılır.
 *
 * ⚠️ Bildirim ≠ ölçüm. Bir descriptor "bu timer var" der; gerçekten kaç kez
 * uyandığını söylemez. Uyanma sayısı ancak sahibi `bumpPerf` çağırırsa
 * ölçülür — bu turda ARM görevleri dışında ölçülmez ve **öyle raporlanır**.
 */

/** F0 §C.10.1 sınıfları — genişletilmez, yorum uydurulmaz. */
export type TimerClass =
  /** Protokol/donanım zamanlaması. Kısılırsa BOZULUR (OBD oturum keepalive…). */
  | 'DOMAIN_HARD_CADENCE'
  /** Ürün mantığı; kadansı güvenle esneyebilir. F2 migration adayı. */
  | 'RUNTIME_BUDGETABLE'
  /** Sessizlik/bayatlık dedektörü. Kısılırsa GEÇ fark eder. */
  | 'WATCHDOG'
  /** Diske yazma zamanlayıcısı. Dayanıklılık semantiğine bağlı. */
  | 'PERSISTENCE'
  /** Ölçüm/kanıt kaydedicisi. */
  | 'OBSERVABILITY'
  /** Bileşen ömürlü görsel timer. Unmount'ta ölür. */
  | 'UI_PRESENTATION'
  /** Ölü/çakışan yol. */
  | 'LEGACY_REDUNDANT'
  /** Sınıflandırılmadı — envanter borcu. */
  | 'UNKNOWN';

/** F2'de ne yapılacağı — bu turda YALNIZ KAYIT, uygulama YOK. */
export type TimerMigrationDecision =
  | 'KEEP_DOMAIN_TIMER' | 'MIGRATE_TO_ARM' | 'COALESCE'
  | 'EVENT_DRIVEN_REPLACE' | 'DEFER' | 'DELETE_IF_REDUNDANT' | 'UNDECIDED';

export interface TimerDescriptor {
  readonly timerId: string;
  readonly owner: string;
  /** `dosya:satır` — envanterin kanıt bağı. */
  readonly sourceRef: string;
  readonly timerClass: TimerClass;
  /** Sahibin varsayılan periyodu (ms). Değişkense `null`. */
  readonly baseCadenceMs: number | null;
  /** ALTINA İNİLEMEZ (protokol/güvenlik tabanı). Bilinmiyorsa `null`. */
  readonly minCadenceMs: number | null;
  /** ÜSTÜNE ÇIKILAMAZ (anlamını yitirir). Bilinmiyorsa `null`. */
  readonly maxCadenceMs: number | null;
  /** Termal/bellek baskısında esner mi. */
  readonly pressureSensitive: boolean;
  /** Arka planda yavaşlar/durur mu. */
  readonly foregroundSensitive: boolean;
  /** ARM kelime dağarcığı — yeni sözlük kurulmadı. */
  readonly criticality: 'SAFETY' | 'NORMAL';
  readonly cleanupOwner: string;
  /** Şu an ARM tik-wheel'inde mi koşuyor. */
  readonly onArmWheel: boolean;
  readonly decision: TimerMigrationDecision;
  readonly rationale: string;
}

const T = (d: TimerDescriptor): TimerDescriptor => Object.freeze(d);

/**
 * UZUN ÖMÜRLÜ TEKRARLAYAN TIMER'LAR.
 *
 * KAPSAM: `platform/` · `core/` · `store/` · `hooks/` katmanındaki tekrarlayan
 * timer'lar. Tek atışlık `setTimeout`lar ve bileşen ömürlü UI timer'ları
 * BİLİNÇLİ OLARAK DIŞARIDADIR: bileşen unmount'ta ölür (zero-leak zaten
 * kurulu) ve her birine descriptor zorunluluğu getirmek envanteri
 * gezilemez hâle getirirdi.
 */
const TIMERS: readonly TimerDescriptor[] = Object.freeze([
  /* ── ARM tik-wheel üstündekiler (zaten bütçeli) ───────────────────── */
  T({ timerId: 'arm.masterWheel', owner: 'AdaptiveRuntimeManager', sourceRef: 'core/runtime/AdaptiveRuntimeManager.ts:1007',
    timerClass: 'DOMAIN_HARD_CADENCE', baseCadenceMs: 333, minCadenceMs: 333, maxCadenceMs: 333,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: 'AdaptiveRuntimeManager.stop()', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Wheel’in KENDİSİ. Çözünürlük sabit olmalı; kısılırsa tüm görevler kayar.' }),
  T({ timerId: 'arm.zombiePing', owner: 'AdaptiveRuntimeManager', sourceRef: 'core/runtime/AdaptiveRuntimeManager.ts:1253',
    timerClass: 'WATCHDOG', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: 'AdaptiveRuntimeManager.stop()', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Worker ölüm dedektörü — kısılırsa çöken worker geç fark edilir.' }),

  /* ── OBD / teşhis: protokol zamanlaması — ARM’e TAŞINMAZ ──────────── */
  T({ timerId: 'obd.diagnosticSessionScheduler', owner: 'obd/diagnosticSessionScheduler', sourceRef: 'platform/obd/diagnosticSessionScheduler.ts:137',
    timerClass: 'DOMAIN_HARD_CADENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: 'stopDiagnosticSessionScheduler', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'ISO oturum canlılığı (3E keepalive). Gecikirse ECU oturumu DÜŞER.' }),
  T({ timerId: 'obd.manufacturerPidPoll', owner: 'obd/manufacturerPidService', sourceRef: 'platform/obd/manufacturerPidService.ts:193',
    timerClass: 'DOMAIN_HARD_CADENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'NORMAL',
    cleanupOwner: 'stopManufacturerPidService', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Poll bütçesi native AdaptivePidScheduler’da; JS ikinci bütçe kurmaz.' }),
  T({ timerId: 'obd.staleWatchdog', owner: 'obdService', sourceRef: 'platform/obdService.ts:1441',
    timerClass: 'WATCHDOG', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: 'stopOBD', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Bayat veri dedektörü — kısılırsa "veri yok" geç anlaşılır.' }),

  /* ── Araç/GPS izleme ─────────────────────────────────────────────── */
  T({ timerId: 'can.staleCheck', owner: 'canBus/VehicleConnectivityManager', sourceRef: 'platform/canBus/VehicleConnectivityManager.ts:273',
    timerClass: 'WATCHDOG', baseCadenceMs: 3_000, minCadenceMs: 3_000, maxCadenceMs: 10_000,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: 'stopVehicleConnectivity', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'CAN bayatlık kapısı; güvenlik sinyallerinin tazeliğini korur.' }),
  T({ timerId: 'gps.silenceChecker', owner: 'gpsService', sourceRef: 'platform/gpsService.ts:1233',
    timerClass: 'WATCHDOG', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: '_drGuardCleanup', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Ölü hesap (DR) koruması — GPS sessizliğini yakalar.' }),
  T({ timerId: 'nav.deadReckoningFeed', owner: 'navigation/navigationSessionRuntime', sourceRef: 'platform/navigation/navigationSessionRuntime.ts:368',
    timerClass: 'DOMAIN_HARD_CADENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: 'stopNavigationSessionRuntime', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'DR besleme — navigasyon doğruluğu; kısılırsa konum sapar.' }),
  T({ timerId: 'location.engineEval', owner: 'location/locationEngineRuntime', sourceRef: 'platform/location/locationEngineRuntime.ts:116',
    timerClass: 'RUNTIME_BUDGETABLE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'LocationEngine.stop()', onArmWheel: false, decision: 'MIGRATE_TO_ARM',
    rationale: 'Değerlendirme döngüsü; tier/termal bütçesine abone olmalı.' }),

  /* ── Medya ───────────────────────────────────────────────────────── */
  T({ timerId: 'media.positionInterpolation', owner: 'mediaService', sourceRef: 'platform/mediaService.ts:214',
    timerClass: 'UI_PRESENTATION', baseCadenceMs: 500, minCadenceMs: 500, maxCadenceMs: 1_000,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: '_stopInterpolation', onArmWheel: false, decision: 'MIGRATE_TO_ARM',
    rationale: 'Saf görsel ilerleme; düşük tier’da 1 Hz yeter. Çalma truth’u ETKİLENMEZ.' }),
  T({ timerId: 'media.hubNativePoll', owner: 'mediaService', sourceRef: 'platform/mediaService.ts:924',
    timerClass: 'WATCHDOG', baseCadenceMs: 5_000, minCadenceMs: 5_000, maxCadenceMs: 10_000,
    pressureSensitive: false, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'stopMediaHub', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Olay köprüsü YOKSA tek veri yolu (poll-only mod), varsa boşluk doldurucu. Kör kısma medya durumunu bayatlatır.' }),
  T({ timerId: 'media.authorityPersist', owner: 'media/authority/mediaAuthorityRuntime', sourceRef: 'platform/media/authority/mediaAuthorityRuntime.ts:243',
    timerClass: 'PERSISTENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'NORMAL',
    cleanupOwner: 'stopMediaAuthority', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Dayanıklılık semantiği — kurtarma verisi. Kısmak veri kaybı penceresini büyütür.' }),

  /* ── Native köprü ────────────────────────────────────────────────── */
  T({ timerId: 'native.guardHeartbeat', owner: 'native/NativeGuardBridge', sourceRef: 'platform/native/NativeGuardBridge.ts:83',
    timerClass: 'DOMAIN_HARD_CADENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'SAFETY',
    cleanupOwner: 'stopNativeGuardBridge', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Native tarafla kalp atışı sözleşmesi.' }),
  T({ timerId: 'native.odometerSync', owner: 'native/NativeGuardBridge', sourceRef: 'platform/native/NativeGuardBridge.ts:88',
    timerClass: 'PERSISTENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'NORMAL',
    cleanupOwner: 'stopNativeGuardBridge', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Kilometre sayacı kalıcılığı — kayıp kullanıcı verisi demektir.' }),

  /* ── Ağ / arka plan: F2 migration adayları ───────────────────────── */
  T({ timerId: 'community.pull', owner: 'communityService', sourceRef: 'platform/communityService.ts:171',
    timerClass: 'RUNTIME_BUDGETABLE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'stopCommunityService', onArmWheel: false, decision: 'MIGRATE_TO_ARM',
    rationale: 'Ağ senkronu; baskıda ilk yavaşlaması gerekenlerden.' }),
  T({ timerId: 'ota.updatePoll', owner: 'otaUpdateService', sourceRef: 'platform/otaUpdateService.ts:403',
    timerClass: 'RUNTIME_BUDGETABLE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'stopOtaService', onArmWheel: false, decision: 'DEFER',
    rationale: 'F2 TAMAMLANDI: servisin KURULUMU IDLE tetikleyicisine alındı (bootDeferral). Timer’ın kendisi servise ait KALDI — kurulum gecikti, davranış değişmedi.' }),
  T({ timerId: 'mapSource.ping', owner: 'mapSourceStore', sourceRef: 'platform/mapSourceStore.ts:122',
    timerClass: 'RUNTIME_BUDGETABLE', baseCadenceMs: 30_000, minCadenceMs: 30_000, maxCadenceMs: 300_000,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'detachNetworkListeners', onArmWheel: true, decision: 'MIGRATE_TO_ARM',
    rationale: 'F2 TAMAMLANDI: ARM tik-wheel’inde (deferIdle). Geri çağrı ve cleanup sahibi modülde KALDI.' }),
  T({ timerId: 'device.statusPoll', owner: 'deviceApi', sourceRef: 'platform/deviceApi.ts:125',
    timerClass: 'RUNTIME_BUDGETABLE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: '_stopPolling (ref-count)', onArmWheel: true, decision: 'MIGRATE_TO_ARM',
    rationale: 'F2 TAMAMLANDI: ARM tik-wheel’inde. Ref-count’lu tek yoklayıcı deseni KORUNDU.' }),
  T({ timerId: 'passenger.stateSync', owner: 'passengerService', sourceRef: 'platform/passengerService.ts:93',
    timerClass: 'RUNTIME_BUDGETABLE', baseCadenceMs: 2_000, minCadenceMs: 2_000, maxCadenceMs: 10_000,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'stopPassenger', onArmWheel: true, decision: 'MIGRATE_TO_ARM',
    rationale: 'F2 TAMAMLANDI: ARM tik-wheel’inde. Yolcu oturumu kapanınca görev SÖKÜLÜR.' }),
  T({ timerId: 'command.remotePoll', owner: 'commandListener', sourceRef: 'platform/commandListener.ts:805',
    timerClass: 'RUNTIME_BUDGETABLE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: true, foregroundSensitive: false, criticality: 'NORMAL',
    cleanupOwner: 'CommandListener.stop()', onArmWheel: false, decision: 'MIGRATE_TO_ARM',
    rationale: 'Uzak komut yoklaması; gecikme toleransı ölçülmeli (F2).' }),

  /* ── Kamera / kayıt: donanım zamanlaması ─────────────────────────── */
  T({ timerId: 'camera.frameFeed', owner: 'cameraService', sourceRef: 'platform/cameraService.ts:69',
    timerClass: 'DOMAIN_HARD_CADENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: true, criticality: 'SAFETY',
    cleanupOwner: 'stopCameraFeed', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Geri görüş kare beslemesi — güvenlik yüzeyi.' }),
  T({ timerId: 'dashcam.segmentRoll', owner: 'dashcamService', sourceRef: 'platform/dashcamService.ts:167',
    timerClass: 'DOMAIN_HARD_CADENCE', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'NORMAL',
    cleanupOwner: 'stopDashcam', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Segment sınırı — kayıt bütünlüğü.' }),

  /* ── Ölçüm/gözlem ────────────────────────────────────────────────── */
  T({ timerId: 'perf.seriesSample', owner: 'perfSeriesRecorder', sourceRef: 'platform/perfSeriesRecorder.ts:179',
    timerClass: 'OBSERVABILITY', baseCadenceMs: 12_000, minCadenceMs: 12_000, maxCadenceMs: 60_000,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'stopPerfSeries', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Ölçümün KENDİSİ. Düşük tier’da FPS salvosu zaten atlanır.' }),
  T({ timerId: 'fieldValidation.longRoadSample', owner: 'fieldValidation/longRoadRecorder', sourceRef: 'platform/fieldValidation/longRoadRecorder.ts:494',
    timerClass: 'OBSERVABILITY', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: true, foregroundSensitive: false, criticality: 'NORMAL',
    cleanupOwner: 'stopLongRoadRecorder', onArmWheel: false, decision: 'KEEP_DOMAIN_TIMER',
    rationale: 'Saha doğrulama kaydı — yalnız açıkça başlatılır.' }),
  T({ timerId: 'debug.storeSample', owner: 'debug/debugStore', sourceRef: 'platform/debug/debugStore.ts:224',
    timerClass: 'OBSERVABILITY', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: true, foregroundSensitive: true, criticality: 'NORMAL',
    cleanupOwner: 'debugStore teardown', onArmWheel: false, decision: 'DEFER',
    rationale: 'DEVTOOLS sınıfı — LAB kapalıyken koşmamalı (F5 kademe 1).' }),

  /* ── Ölü yol ─────────────────────────────────────────────────────── */
  T({ timerId: 'boot.obdDataPlaceholderListener', owner: 'main.tsx', sourceRef: 'main.tsx (KALDIRILDI — F2)',
    timerClass: 'LEGACY_REDUNDANT', baseCadenceMs: null, minCadenceMs: null, maxCadenceMs: null,
    pressureSensitive: false, foregroundSensitive: false, criticality: 'NORMAL',
    cleanupOwner: 'YOK — handle atılıyordu', onArmWheel: false, decision: 'DELETE_IF_REDUNDANT',
    rationale: 'F2 TAMAMLANDI: kaldırıldı. Gövde boştu, cleanup yoktu ve geri vites sinyalinin kaynağı canData yoludur — davranış DEĞİŞMEDİ.' }),
]);

/** ARM tik-wheel'ini kullanan alanlar (F0 §C.10.3 — 12 tüketici). */
const ARM_WHEEL_OWNERS: readonly string[] = Object.freeze([
  'smartCardEngine', 'arAlignmentService', 'autoBrightnessService', 'breakReminderService',
  'communityService', 'companionEngine', 'hazardService', 'carosMediaLayer',
  'guardianRuntime', 'predictionRuntime', 'vehicleIntelligenceService', 'useAssistantContextStore',
]);

export interface TimerInventorySnapshot {
  readonly timers: readonly TimerDescriptor[];
  readonly byClass: Readonly<Record<TimerClass, number>>;
  readonly byDecision: Readonly<Record<TimerMigrationDecision, number>>;
  /** ARM wheel'ini kullandığı ÖLÇÜLMÜŞ alan adedi. */
  readonly armWheelOwnerCount: number;
  /** Bildirilmiş timer adedi — repo'daki TOPLAM timer sayısı DEĞİL. */
  readonly declaredCount: number;
  /** F2'de taşınacak/silinecek aday adedi. */
  readonly migrationCandidateCount: number;
  readonly unknownCount: number;
  readonly notes: readonly string[];
  readonly provenance: readonly string[];
}

const CLASSES: readonly TimerClass[] = Object.freeze([
  'DOMAIN_HARD_CADENCE', 'RUNTIME_BUDGETABLE', 'WATCHDOG', 'PERSISTENCE',
  'OBSERVABILITY', 'UI_PRESENTATION', 'LEGACY_REDUNDANT', 'UNKNOWN',
]);
const DECISIONS: readonly TimerMigrationDecision[] = Object.freeze([
  'KEEP_DOMAIN_TIMER', 'MIGRATE_TO_ARM', 'COALESCE',
  'EVENT_DRIVEN_REPLACE', 'DEFER', 'DELETE_IF_REDUNDANT', 'UNDECIDED',
]);

/** Salt-okunur projeksiyon. Hiçbir timer'a dokunmaz. */
export function getTimerInventory(): TimerInventorySnapshot {
  const byClass = {} as Record<TimerClass, number>;
  for (const c of CLASSES) byClass[c] = 0;
  const byDecision = {} as Record<TimerMigrationDecision, number>;
  for (const d of DECISIONS) byDecision[d] = 0;

  let migration = 0;
  for (const t of TIMERS) {
    byClass[t.timerClass] += 1;
    byDecision[t.decision] += 1;
    if (t.decision === 'MIGRATE_TO_ARM' || t.decision === 'DEFER'
      || t.decision === 'DELETE_IF_REDUNDANT' || t.decision === 'COALESCE'
      || t.decision === 'EVENT_DRIVEN_REPLACE') migration += 1;
  }

  return Object.freeze({
    timers: TIMERS,
    byClass: Object.freeze(byClass),
    byDecision: Object.freeze(byDecision),
    armWheelOwnerCount: ARM_WHEEL_OWNERS.length,
    declaredCount: TIMERS.length,
    migrationCandidateCount: migration,
    unknownCount: byClass.UNKNOWN,
    notes: Object.freeze([
      'Bu envanter BİLDİRİMDİR: bir timer’ın VARLIĞINI söyler, kaç kez UYANDIĞINI SÖYLEMEZ.',
      'Uyanma sayısı yalnız sahibi sayaç çağırırsa ölçülür — bu turda ARM görevleri dışında ÖLÇÜLMEZ.',
      'Kapsam: uzun ömürlü tekrarlayan timer’lar. Tek atışlık setTimeout ve bileşen ömürlü UI timer’ları KAPSAM DIŞI.',
      'Bildirilen sayı repo’daki TOPLAM timer sayısı DEĞİLDİR; kapsanmayanlar envanter borcudur.',
    ]),
    provenance: Object.freeze(['perf/timerInventory.ts (statik bildirim)']),
  });
}

/** Statik kilit testleri için kapalı liste. */
export function timerDescriptors(): readonly TimerDescriptor[] { return TIMERS; }
export function armWheelOwners(): readonly string[] { return ARM_WHEEL_OWNERS; }
