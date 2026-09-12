/**
 * performanceAggregator — ARCH-06/F1 · SALT-OKUNUR PERFORMANS PROJEKSİYONU.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **MEGA PERFORMANS DEPOSU DEĞİLDİR.** Hiçbir metriği SAKLAMAZ. Her
 *     çağrıda sahiplerden okur ve serbest bırakır.
 * (2) **YAZMAZ.** Hiçbir sahibin durumunu değiştirmez, sayaç sıfırlamaz,
 *     cache boşaltmaz, mod değiştirmez.
 * (3) **YÜRÜTMEZ.** Timer kurmaz, abonelik açmaz, benchmark koşturmaz,
 *     servis başlatmaz. Yalnız ÇEKER (pull).
 * (4) **HÜKÜM VERMEZ.** "Yavaş" · "sağlıklı" · "regresyon" demez. Eşik
 *     yoktur; eşikler baseline ölçüldükten sonra F2+'da konur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── T2 KADEMESİ ───────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu projeksiyon PAHALIDIR (dizi kopyalama · `Object.freeze` · 13 bölüm) ve
 * **T2** kademesindedir: yalnız LAB ekranı MOUNT edildiğinde ya da taban
 * dışa aktarılırken çağrılır. LAB kapalıyken burası KOŞMAZ — kilit testi
 * bunu sabitler.
 *
 * Her sahibin okuması `try/catch` içindedir: bir kaynak düşerse o bölüm
 * `UNAVAILABLE` olur, toplama DÜŞMEZ ve sahte satır ÜRETİLMEZ.
 */

import {
  measured, derived, unmeasured, section, perfNow, ratePerSec,
  type PerfMetric, type PerfSection,
} from './perfContract';
import {
  getPerfCounters, getPerfCountersStartedAt, perfCounterIds,
  type PerfCounterId, type PerfCounterSnapshot,
} from './perfCounters';
import { getBootMilestoneSnapshot, getBootTimingSnapshot } from '../bootTimingRecorder';
import { getPerfSeriesSnapshot } from '../perfSeriesRecorder';
import { getTimerInventory } from './timerInventory';
import { getMemoryInventory } from './memoryInventory';
import { getBootDeferralEvidence } from '../boot/bootDeferral';
import {
  getWorkloadCeilings, getObservedTierEvidence, getHysteresisContract,
  workloadOrder, ceilingOwnership, boundWorkloads, ceilingFor,
} from './workloadCeilings';
import { getMapInstanceEvidence } from './mapInstanceEvidence';
import { getRenderClassContract } from './renderClassContract';
import { getBridgePolicy } from './bridgePolicyContract';
import { getMemoryTrimEvidence } from '../memoryWatchdog';
import { getStorageWriteReasons, getEmmcWriteCount } from '../../utils/safeStorage';
import { getPollCostSnapshot, getPollCostRefreshedAt } from '../obd/pollCost';

const OWNER_COUNTERS = 'perfCounters';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/* ══════════════════════════════════════════════════════════════════════════
   1) BOOT
   ══════════════════════════════════════════════════════════════════════════ */

function bootSection(): PerfSection {
  const snap = safe(() => getBootMilestoneSnapshot(), null);
  const waves = safe(() => getBootTimingSnapshot(), null);
  if (snap === null) {
    return section('boot', [unmeasured('boot.milestones', 'bootTimingRecorder', 'count', 'kaynak okunamadı')]);
  }
  const metrics: PerfMetric[] = [];
  for (const row of snap.milestones) {
    metrics.push(measured({
      name: `boot.${row.milestone.toLowerCase()}`,
      owner: 'bootTimingRecorder',
      /* `PROCESS_STARTED`tan geçen süre. Damga yoksa `null` — taş DÜŞMEDİ,
         "0 ms sürdü" DEMEK DEĞİLDİR. */
      value: row.elapsedMs,
      unit: 'ms',
      observedAt: row.observedAt,
      provenance: row.provenance !== null ? [row.provenance] : ['damga alınmadı'],
    }));
  }
  metrics.push(derived({
    name: 'boot.milestones.observed',
    owner: 'bootTimingRecorder',
    value: snap.observedCount, unit: 'count',
    provenance: [`${snap.observedCount}/${snap.totalCount} taş ölçüldü`],
  }));
  if (waves !== null) {
    metrics.push(measured({
      name: 'boot.total', owner: 'bootTimingRecorder',
      value: waves.totalMs > 0 ? waves.totalMs : null, unit: 'ms',
      provenance: ['bootTimingRecorder.getBootTimingSnapshot()'],
    }));
    for (const w of waves.waves) {
      metrics.push(measured({
        name: `boot.wave.${w.name.replace(/\s+/g, '_').toLowerCase()}`,
        owner: 'SystemBoot', value: w.durationMs, unit: 'ms',
        provenance: ['bootTimingRecorder.recordBootWave()'],
      }));
    }
  }
  return section('boot', metrics, [
    'INITIALIZED ≠ AVAILABLE: alt yapının kurulması, kullanılabilirlik KANITI DEĞİLDİR.',
    'Araç bağlı değilse VEHICLE_DATA_FIRST_OBSERVATION taşı DÜŞMEZ — bu dürüst sonuçtur.',
    'SHELL_INTERACTIVE iki kaynaktan gelebilir (gerçek girdi | idle sınırı); kaynak provenance’ta.',
  ]);
}

function bootDeferralSection(): PerfSection {
  const rows = safe(() => getBootDeferralEvidence(), []);
  if (rows.length === 0) {
    return section('boot_deferral', [
      unmeasured('boot.deferred.jobs', 'bootDeferral', 'count', 'erteleme kaydı yok (boot koşmadı)'),
    ]);
  }
  const metrics: PerfMetric[] = rows.map((r) => measured({
    name: `boot.deferred.${r.jobId}`,
    owner: 'bootDeferral',
    /* Kayıt → gerçek başlangıç arası GECİKME. Henüz koşmadıysa `null`. */
    value: r.delayMs, unit: 'ms',
    observedAt: r.actualStartAt,
    provenance: [r.trigger, r.bootClass, r.outcome, `wave ${r.wave}`],
  }));
  const started = rows.filter((r) => r.outcome === 'STARTED').length;
  const failed = rows.filter((r) => r.outcome === 'FAILED').length;
  const aborted = rows.filter((r) => r.outcome === 'ABORTED_BEFORE_START').length;
  metrics.push(derived({ name: 'boot.deferred.started', owner: 'bootDeferral', value: started, unit: 'count',
    provenance: ['gerçekten kurulan ertelenmiş servis'] }));
  metrics.push(derived({ name: 'boot.deferred.failed', owner: 'bootDeferral', value: failed, unit: 'count',
    provenance: ['başlatma düştü — sessizce yutulmadı'] }));
  metrics.push(derived({ name: 'boot.deferred.abortedBeforeStart', owner: 'bootDeferral', value: aborted, unit: 'count',
    provenance: ['stop tetikleyiciden önce geldi — sıfır yan etki'] }));
  return section('boot_deferral', metrics, [
    'Ertelenen iş KAYBOLMAZ: ya STARTED olur ya AÇIK bir iptal/hata kaydı bırakır.',
    'ABORTED_BEFORE_START bir ARIZA DEĞİLDİR — stop sonrası doğru davranıştır.',
  ]);
}

function bootServicesSection(): PerfSection {
  const snap = safe(() => getBootMilestoneSnapshot(), null);
  if (snap === null || snap.services.length === 0) {
    return section('boot_services', [
      unmeasured('boot.services', 'SystemBoot', 'count', 'servis ölçümü yok (boot koşmadı veya damga alınmadı)'),
    ]);
  }
  const metrics = snap.services.map((svc) => measured({
    name: `boot.service.${svc.serviceId}`,
    owner: 'SystemBoot',
    value: svc.durationMs, unit: 'ms',
    observedAt: svc.startedAt,
    provenance: [`wave ${svc.wave}`, svc.blocking ? 'blocking (await)' : 'non-blocking', svc.outcome],
  }));
  return section('boot_services', metrics, [
    'Ölçüm SystemBoot çalıştırma sırasını DEĞİŞTİRMEZ; yalnız start→resolve süresini gözler.',
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════
   2) JS THREAD / RENDER
   ══════════════════════════════════════════════════════════════════════════ */

function renderSection(): PerfSection {
  /* Tarayıcı gerçek Android "dropped frame" sayacı VERMEZ. Bu satır HER İKİ
     dalda da bulunmalıdır: örnek yokken metriği listeden düşürmek, "böyle bir
     metrik yok" demek olurdu — oysa metrik VAR ve ÖLÇÜLEMİYOR. */
  const gpuUnmeasured = unmeasured('render.gpuDroppedFrames', 'platform', 'count',
    'tarayıcı GPU dropped-frame sayacı SAĞLAMAZ — native kanıt olmadan uydurulmaz');

  const series = safe(() => getPerfSeriesSnapshot(), null);
  if (series === null || series.samples.length === 0) {
    return section('render', [
      unmeasured('render.fps', 'perfSeriesRecorder', 'fps', 'örnek yok — kaydedici henüz örneklemedi'),
      unmeasured('render.maxFrameGapMs', 'perfSeriesRecorder', 'ms', 'örnek yok'),
      unmeasured('jsthread.lagMs', 'perfSeriesRecorder', 'ms', 'örnek yok'),
      unmeasured('jsthread.longTaskMaxMs', 'perfSeriesRecorder', 'ms', 'örnek yok'),
      unmeasured('jsthread.longTaskCount', 'perfSeriesRecorder', 'count', 'örnek yok'),
      unmeasured('render.sampleCount', 'perfSeriesRecorder', 'count', 'örnek yok'),
      gpuUnmeasured,
    ], ['perfSeriesRecorder 12 s aralıkla örnekler; ilk örnek gelene kadar KAYNAK YOK.']);
  }
  const last = series.samples[series.samples.length - 1]!;
  /* `-1` bu kaydedicinin "ölçülmedi" sentinel'idir; sözleşmeye `null` olarak
     çevrilir — 0 FPS "ekran donuyor" demek olurdu. */
  const nz = (v: number): number | null => (v >= 0 ? v : null);
  const metrics: PerfMetric[] = [
    measured({ name: 'render.fps', owner: 'perfSeriesRecorder', value: nz(last.fps), unit: 'fps',
      sampleWindowMs: series.sampleMs, provenance: ['rAF salvosu (düşük tier’da ATLANIR)'] }),
    measured({ name: 'render.maxFrameGapMs', owner: 'perfSeriesRecorder', value: nz(last.maxGapMs), unit: 'ms',
      sampleWindowMs: series.sampleMs, provenance: ['salvodaki en büyük kare aralığı'] }),
    measured({ name: 'jsthread.lagMs', owner: 'perfSeriesRecorder', value: last.lagMs, unit: 'ms',
      sampleWindowMs: series.sampleMs, provenance: ['zamanlayıcı sapması — jank vekili'] }),
    measured({ name: 'jsthread.longTaskMaxMs', owner: 'perfSeriesRecorder', value: nz(last.maxLongTaskMs), unit: 'ms',
      sampleWindowMs: series.sampleMs, provenance: ['PerformanceObserver(longtask) — PASİF'] }),
    measured({ name: 'jsthread.longTaskCount', owner: 'perfSeriesRecorder', value: last.longTaskCount, unit: 'count',
      sampleWindowMs: series.sampleMs, provenance: ['≥50 ms görev adedi (son pencere)'] }),
    measured({ name: 'render.sampleCount', owner: 'perfSeriesRecorder', value: series.samples.length, unit: 'count',
      provenance: ['halka doluluk'] }),
    gpuUnmeasured,
  ];
  return section('render', metrics, [
    'FPS düşüşü SERVİS ARIZASI DEĞİLDİR; yalnız görsel bütçe sinyalidir.',
    'Düşük tier’da FPS salvosu bilinçli ATLANIR → fps null olabilir, bu bir hata değildir.',
  ]);
}

function longTaskAttributionSection(): PerfSection {
  /* Tarayıcının `longtask` girdisi güvenilir bir SAHİP vermez
     (`attribution` alanı çoğu WebView’da boş/"unknown"dur). Uydurmak yerine
     bunu AÇIKÇA ölçülemez ilan ediyoruz; F1'in dürüst sonucu budur. */
  return section('longtask_attribution', [
    unmeasured('jsthread.longTaskOwner', 'perfSeriesRecorder', 'none',
      'PerformanceObserver güvenilir owner/attribution VERMEZ — sahte sahip atanmadı'),
  ], [
    'Attribution ancak ARCH-03 operationId ile KORELASYON kurularak tahmin edilebilir.',
    'Korelasyon güvenilir olmadığı sürece owner UNKNOWN kalır (F0 §17 kuralı).',
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SAYAÇ TABANLI BÖLÜMLER
   ══════════════════════════════════════════════════════════════════════════ */

/** Kümülatif sayaç + süreye bölünmüş türev hız. */
function counterMetrics(
  counters: PerfCounterSnapshot, windowMs: number | null,
  rows: readonly (readonly [PerfCounterId, string])[],
): PerfMetric[] {
  const out: PerfMetric[] = [];
  const at = perfNow();
  for (const [id, label] of rows) {
    const v = counters[id];
    out.push(measured({
      name: `${id}.total`, owner: OWNER_COUNTERS, value: v, unit: 'count',
      observedAt: at, provenance: [label],
    }));
    out.push(derived({
      name: `${id}.rate`, owner: OWNER_COUNTERS,
      value: ratePerSec(v, windowMs), unit: 'per_sec',
      sampleWindowMs: windowMs, observedAt: at,
      provenance: ['oturum başından beri ORTALAMA — anlık hız DEĞİL'],
    }));
  }
  return out;
}

function sessionWindowMs(): number | null {
  const started = getPerfCountersStartedAt();
  const now = perfNow();
  if (started === null || now === null) return null;
  const w = now - started;
  return w > 0 ? w : null;
}

function bridgeSection(counters: PerfCounterSnapshot, windowMs: number | null): PerfSection {
  return section('bridge', counterMetrics(counters, windowMs, [
    ['bridge.canData.received', 'CanAdapter — native COALESCING SONRASI olay'],
    ['bridge.obdData.received', 'obdService — native poll planına göre'],
    ['bridge.obdStatus.received', 'obdService durum geçişi'],
    ['bridge.obdTraffic.received', 'debug halkası (ON_DEMAND)'],
    ['bridge.mediaChanged.received', 'mediaService'],
    ['bridge.mediaAuthorityEvent.received', 'media authority'],
    ['bridge.memoryPressure.received', 'memoryWatchdog'],
    ['bridge.thermalStatus.received', 'thermalWatchdog'],
    ['bridge.phoneControl.received', 'companion kontrol düzlemi'],
    ['bridge.hardwareMedia.received', 'donanım medya tuşu'],
    ['bridge.incomingLocation.received', 'gelen konum'],
    ['bridge.sendDiagnosticPdu.called', 'TS→native teşhis PDU'],
    ['bridge.mediaCommand.called', 'TS→native medya komutu'],
  ]), [
    'canData sayacı HAM CAN FRAME HIZI DEĞİLDİR: native 80 ms coalescing + dedup SONRASI olaydır.',
    'Ham frame hızı için CAN bölümündeki inputCount okunmalıdır.',
    'payloadBytes T0’da ÖLÇÜLMEZ — ölçmek istediğimiz maliyeti üretirdi (§39).',
  ]);
}

function canVdlSection(counters: PerfCounterSnapshot, windowMs: number | null): PerfSection {
  const offered = counters['can.vdlPatchOffered'];
  const written = counters['can.vdlPatchWritten'];
  const skipped = counters['can.vdlPatchSkipped'];
  const fields = counters['can.vdlPatchFields'];
  const metrics: PerfMetric[] = [
    ...counterMetrics(counters, windowMs, [
      ['can.vdlPatchOffered', 'CAN emit’i VDL sınırına ULAŞTI'],
      ['can.vdlPatchWritten', 'en az bir alan DEĞİŞTİ → tek atomik set()'],
      ['can.vdlPatchSkipped', 'hiçbir alan değişmedi → abone UYANDIRILMADI'],
    ]),
    derived({
      name: 'can.vdlWriteRatio', owner: OWNER_COUNTERS,
      value: offered > 0 ? written / offered : null, unit: 'ratio',
      provenance: ['yazılan / sunulan — düşükse dedup çok kazandırıyor'],
    }),
    derived({
      name: 'can.vdlAvgPatchFields', owner: OWNER_COUNTERS,
      value: written > 0 ? fields / written : null, unit: 'count',
      provenance: ['yazım başına ORTALAMA değişen alan sayısı (22 alanlık tam yazımın karşıtı)'],
    }),
    measured({
      name: 'can.vdlPatchSkipped.total', owner: OWNER_COUNTERS,
      value: skipped, unit: 'count', provenance: ['tamamen atlanan yazım'],
    }),
  ];
  return section('can_vdl', metrics, [
    'Değişen-alan dedup’ı ZATEN store sınırındaydı; F4 onu ÖLÇÜLEBİLİR yaptı.',
    'UNKNOWN sıfıra ÇEVRİLMEZ: `val == null` kapısı alanı hiç yazmaz.',
    'Ölçülmüş 0 GEÇERLİ bir değerdir ve yazılır — `null` ile karıştırılmaz.',
  ]);
}

function obdSection(): PerfSection {
  const poll = safe(() => getPollCostSnapshot(), null);
  const at = safe(() => getPollCostRefreshedAt(), null);
  if (poll === null || poll.state === 'UNAVAILABLE') {
    return section('obd', [
      unmeasured('obd.pollCost', 'PollCostLedger (native)', 'count',
        'native poll maliyet kanıtı YOK (eski APK ya da OBD bağlı değil) — sayılar 0 GÖSTERİLMEZ'),
    ], ['OBD poll otoritesi native AdaptivePidScheduler’dadır; burası YALNIZ projeksiyondur.']);
  }
  const t = poll.totals;
  return section('obd', [
    measured({ name: 'obd.cyclesRecorded', owner: 'PollCostLedger', value: poll.cyclesRecorded,
      unit: 'count', observedAt: at, provenance: ['native ölçüm — ikinci OBD gerçeği KURULMADI'] }),
    measured({ name: 'obd.burstCycles', owner: 'PollCostLedger', value: poll.burstCyclesRecorded,
      unit: 'count', observedAt: at, provenance: ['burst döngüsü — canlı telemetriden AYRI'] }),
    measured({ name: 'obd.diagnosticPayloadRequests', owner: 'PollCostLedger',
      value: t.diagnosticPayloadRequests, unit: 'count', observedAt: at,
      provenance: ['gerçek teşhis yükü'] }),
    measured({ name: 'obd.adapterControlCommands', owner: 'PollCostLedger',
      value: t.adapterControlCommands, unit: 'count', observedAt: at,
      provenance: ['AT komutu ek yükü — teşhis DEĞİL'] }),
    measured({ name: 'obd.redundantHeaderSwitches', owner: 'PollCostLedger',
      value: t.redundantHeaderSwitches, unit: 'count', observedAt: at,
      provenance: ['GEREKSİZ header değişimi — doğrudan israf göstergesi'] }),
    measured({ name: 'obd.noResponses', owner: 'PollCostLedger', value: t.noResponses,
      unit: 'count', observedAt: at, provenance: ['yanıtsız istek'] }),
    measured({ name: 'obd.payloadMs', owner: 'PollCostLedger', value: t.payloadMs,
      unit: 'ms', observedAt: at, provenance: ['yükte geçen süre'] }),
    measured({ name: 'obd.adapterMs', owner: 'PollCostLedger', value: t.adapterMs,
      unit: 'ms', observedAt: at, provenance: ['adaptör ek yükünde geçen süre'] }),
    measured({ name: 'obd.unattributedCommands', owner: 'PollCostLedger',
      value: poll.unattributedCommands, unit: 'count', observedAt: at,
      provenance: ['sınıflandırılamayan komut — dürüst boşluk'] }),
  ], [
    'CANLI TELEMETRİ ile BURST/derin teşhis AYRI sayılır (burstCycles).',
    'İkinci OBD performans gerçeği KURULMADI: bu bölüm native PollCostLedger’ın salt-okunur projeksiyonudur.',
    'adapterControlCommands / diagnosticPayloadRequests oranı yüksekse ek yük baskındır.',
  ]);
}

function bridgePolicySection(): PerfSection {
  const p = safe(() => getBridgePolicy(), null);
  if (p === null) {
    return section('bridge_policy', [
      unmeasured('bridge.surfaces', 'bridgePolicyContract', 'count', 'sözleşme okunamadı'),
    ]);
  }
  const metrics: PerfMetric[] = [
    measured({ name: 'bridge.surfaces.declared', owner: 'bridgePolicyContract',
      value: p.surfaces.length, unit: 'count', provenance: ['sınıflandırılmış köprü yüzeyi'] }),
    measured({ name: 'bridge.safetyCritical', owner: 'bridgePolicyContract',
      value: p.safetyCriticalCount, unit: 'count',
      provenance: ['batch/coalesce YASAK olan yüzey'] }),
  ];
  for (const [cls, n] of Object.entries(p.byClass)) {
    metrics.push(measured({ name: `bridge.class.${cls.toLowerCase()}`, owner: 'bridgePolicyContract',
      value: n, unit: 'count', provenance: ['sınıf dağılımı'] }));
  }
  return section('bridge_policy', metrics, p.notes);
}

function gpsSection(counters: PerfCounterSnapshot, windowMs: number | null): PerfSection {
  const metrics = counterMetrics(counters, windowMs, [
    ['gps.providerCallback', 'sağlayıcıdan gelen ham geri çağrı'],
    ['gps.fixAccepted', 'throttle ve doğrulamayı GEÇEN fix'],
    ['gps.fixThrottled', 'throttle penceresinde ELENEN fix'],
  ]);
  const cb = counters['gps.providerCallback'];
  const acc = counters['gps.fixAccepted'];
  metrics.push(derived({
    name: 'gps.acceptRatio', owner: OWNER_COUNTERS,
    value: cb > 0 ? acc / cb : null, unit: 'ratio',
    sampleWindowMs: windowMs,
    provenance: ['kabul / gelen — throttle etkinliği'],
  }));
  return section('gps', metrics, [
    'GPS kadans otoritesi gpsService’tedir; bu bölüm YALNIZ ölçümdür.',
    'Elenen fix KAYIP DEĞİLDİR: truth zaten kabul edilen fix’ten türer.',
  ]);
}

function mapSection(counters: PerfCounterSnapshot, windowMs: number | null): PerfSection {
  const metrics = counterMetrics(counters, windowMs, [
    ['map.cameraCommand', 'MapInteractionManager easeTo/jumpTo'],
    ['map.setDataCall', 'MapLayerManager kaynak verisi yazımı'],
    ['map.routeGeometryRebuild', 'rota geometrisinin TAM yeniden kurulumu'],
    ['map.styleReload', 'stil yeniden yüklemesi (en pahalı harita olayı)'],
  ]);
  const mounted = counters['map.instanceMounted'];
  const unmounted = counters['map.instanceUnmounted'];
  metrics.push(measured({
    name: 'map.instanceMounted.total', owner: OWNER_COUNTERS, value: mounted, unit: 'count',
    provenance: ['MapCore — MapLibre örneği kuruldu'],
  }));
  metrics.push(measured({
    name: 'map.instanceUnmounted.total', owner: OWNER_COUNTERS, value: unmounted, unit: 'count',
    provenance: ['MapCore — WebGL bağlamı serbest bırakıldı'],
  }));
  metrics.push(derived({
    name: 'map.activeInstanceCount', owner: OWNER_COUNTERS,
    value: mounted - unmounted, unit: 'count',
    provenance: ['kurulan − yıkılan. F0 açık sorusu: MiniMap + FullMap eşzamanlı iki bağlam mı?'],
  }));
  /* ── ARCH-06/F3 · kamera dedup ve rota sunum kanıtı ─────────────────── */
  const computed = counters['map.cameraTargetComputed'];
  const dedup = counters['map.cameraDedupSkipped'];
  metrics.push(measured({ name: 'map.cameraTargetComputed.total', owner: OWNER_COUNTERS,
    value: computed, unit: 'count', provenance: ['hedef hesaplandı (dedup kararından ÖNCE)'] }));
  metrics.push(measured({ name: 'map.cameraDedupSkipped.total', owner: OWNER_COUNTERS,
    value: dedup, unit: 'count', provenance: ['AYNI hedef — harita mutasyonu GÖNDERİLMEDİ'] }));
  metrics.push(derived({ name: 'map.cameraDedupRatio', owner: OWNER_COUNTERS,
    value: computed > 0 ? dedup / computed : null, unit: 'ratio',
    provenance: ['atlanan / hesaplanan — kamera coalescing kazancı'] }));
  metrics.push(measured({ name: 'map.cameraSuppressedByUser.total', owner: OWNER_COUNTERS,
    value: counters['map.cameraSuppressedByUser'], unit: 'count',
    provenance: ['kullanıcı pan/zoom yaptı → takip kamerası bastırıldı'] }));
  metrics.push(measured({ name: 'map.routeGeometryDedupSkip.total', owner: OWNER_COUNTERS,
    value: counters['map.routeGeometryDedupSkip'], unit: 'count',
    provenance: ['aynı rota kimliği → TAM geometri yeniden kurulumu ATLANDI'] }));

  /* ── Harita örneği yaşam döngüsü (F0’ın açık sorusu) ─────────────────── */
  const inst = safe(() => getMapInstanceEvidence(), null);
  if (inst !== null) {
    metrics.push(measured({ name: 'map.instances.active', owner: 'mapInstanceEvidence',
      value: inst.active, unit: 'count', provenance: ['şu an canlı MapLibre bağlamı'] }));
    metrics.push(measured({ name: 'map.instances.peakConcurrent', owner: 'mapInstanceEvidence',
      value: inst.peakConcurrent, unit: 'count',
      provenance: ['oturumdaki EN YÜKSEK eşzamanlı sayı — F0 açık sorusunun cevabı'] }));
    metrics.push(measured({ name: 'map.instances.created', owner: 'mapInstanceEvidence',
      value: inst.createdTotal, unit: 'count', provenance: ['toplam kurulum'] }));
    metrics.push(measured({ name: 'map.instances.destroyed', owner: 'mapInstanceEvidence',
      value: inst.destroyedTotal, unit: 'count', provenance: ['toplam yıkım'] }));
  }

  return section('map', metrics, [
    'MapLibre render loop’u KENDİ otoritesindedir; buradaki sayaçlar UYGULAMA mutasyonlarını sayar.',
    'Koordinat, bearing ve rota geometrisi ölçüm katmanına TAŞINMAZ.',
    'peakConcurrent > 1 bir ARIZA BEYANI DEĞİLDİR: geçiş anında kısa örtüşme olabilir. Sayı verilir, hüküm okuyucunundur.',
    'cameraDedupRatio yüksekse coalescing çalışıyor demektir — düşükse kamera girdisi gerçekten değişiyordur.',
  ]);
}

function storageSection(counters: PerfCounterSnapshot, windowMs: number | null): PerfSection {
  const metrics = counterMetrics(counters, windowMs, [
    ['storage.setRequest', 'safeSetRaw çağrısı (yazma İSTEĞİ)'],
    ['storage.flush', 'GERÇEK disk yazımı (_commitToStorage)'],
    ['storage.largeWrite', '>50 KB yük — idle callback ile ertelenen'],
    ['storage.idleDeferred', 'debounce sonrası idle’a ertelenen yazım'],
  ]);
  const req = counters['storage.setRequest'];
  const flush = counters['storage.flush'];
  metrics.push(derived({
    name: 'storage.writeAmplification', owner: OWNER_COUNTERS,
    value: req > 0 ? flush / req : null, unit: 'ratio',
    provenance: ['gerçek yazım / istek — debounce etkinliği (düşük = iyi)'],
  }));
  return section('storage', metrics, [
    'Anahtar DEĞERİ, kullanıcı içeriği ve anahtar adı ölçüme GİRMEZ.',
    'Debounce penceresi ve dayanıklılık semantiği bu turda DEĞİŞMEDİ.',
  ]);
}

function artworkSection(counters: PerfCounterSnapshot): PerfSection {
  const changed = counters['artwork.sourceChanged'];
  const dedup = counters['artwork.hashDedupHit'];
  const decode = counters['artwork.accentDecode'];
  return section('artwork', [
    measured({ name: 'artwork.sourceChanged.total', owner: OWNER_COUNTERS, value: changed, unit: 'count',
      provenance: ['yeni kapak kaynağı (djb2 hash değişti)'] }),
    measured({ name: 'artwork.hashDedupHit.total', owner: OWNER_COUNTERS, value: dedup, unit: 'count',
      provenance: ['aynı kapak — yeniden işleme ATLANDI'] }),
    measured({ name: 'artwork.accentDecode.total', owner: OWNER_COUNTERS, value: decode, unit: 'count',
      provenance: ['GERÇEK görsel decode (accent örneklemesi)'] }),
    unmeasured('artwork.decodedBytes', 'mediaService', 'bytes',
      'decoded bitmap boyutu tarayıcıdan ÖLÇÜLEMEZ — yalnız ölçüm için tam decode YAPILMAZ'),
    unmeasured('artwork.visibleConsumerCount', 'components', 'count',
      'eşzamanlı gösterim adedi ucuz ölçülemez — F5’te tek-decode tasarımıyla ele alınacak'),
  ], [
    'F5’in tabanı: aynı kapak kaç kez DEĞİŞTİ, kaç kez ATLANDI, kaç kez DECODE edildi.',
    'Bu turda YALNIZ ÖLÇÜM — cache/downsample tasarımı F5’tedir.',
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ENVANTER BÖLÜMLERİ
   ══════════════════════════════════════════════════════════════════════════ */

function renderClassSection(): PerfSection {
  const c = safe(() => getRenderClassContract(), null);
  if (c === null) {
    return section('render_class', [
      unmeasured('render.surfaces', 'renderClassContract', 'count', 'sözleşme okunamadı'),
    ]);
  }
  const metrics: PerfMetric[] = [
    measured({ name: 'render.surfaces.declared', owner: 'renderClassContract',
      value: c.surfaces.length, unit: 'count', provenance: ['bildirilen yüksek frekanslı yüzey'] }),
  ];
  for (const [cls, n] of Object.entries(c.byClass)) {
    metrics.push(measured({ name: `render.class.${cls.toLowerCase()}`, owner: 'renderClassContract',
      value: n, unit: 'count', provenance: ['sınıf dağılımı'] }));
  }
  for (const id of ['fullMapView', 'miniMapWidget', 'navigationHud'] as const) {
    metrics.push(unmeasured(`render.${id}.count`, 'components', 'count',
      'bileşen render sayacı bu turda ÜRETİM yoluna TAKILMADI — sıcak render yolunda sayaç bile maliyet üretir'));
  }
  return section('render_class', metrics, c.notes);
}

function timerSection(): PerfSection {
  const inv = safe(() => getTimerInventory(), null);
  if (inv === null) {
    return section('timers', [unmeasured('timers.declared', 'timerInventory', 'count', 'envanter okunamadı')]);
  }
  const metrics: PerfMetric[] = [
    measured({ name: 'timers.declared', owner: 'timerInventory', value: inv.declaredCount, unit: 'count',
      provenance: ['bildirilen uzun ömürlü tekrarlayan timer'] }),
    measured({ name: 'timers.armWheelOwners', owner: 'timerInventory', value: inv.armWheelOwnerCount, unit: 'count',
      provenance: ['ARM tik-wheel’ini kullanan alan adedi'] }),
    measured({ name: 'timers.migrationCandidates', owner: 'timerInventory', value: inv.migrationCandidateCount, unit: 'count',
      provenance: ['F2 adayı (MIGRATE | DEFER | DELETE | COALESCE)'] }),
    measured({ name: 'timers.unknownClass', owner: 'timerInventory', value: inv.unknownCount, unit: 'count',
      provenance: ['sınıflandırılmamış — envanter borcu'] }),
    unmeasured('timers.wakeRate', 'timerInventory', 'per_sec',
      'global setInterval sarmalaması YAPILMADI — sarmak ölçülen sistemi değiştirirdi'),
  ];
  for (const [cls, n] of Object.entries(inv.byClass)) {
    metrics.push(measured({ name: `timers.class.${cls.toLowerCase()}`, owner: 'timerInventory',
      value: n, unit: 'count', provenance: ['sınıf dağılımı'] }));
  }
  return section('timers', metrics, inv.notes);
}

function memorySection(): PerfSection {
  const inv = safe(() => getMemoryInventory(), null);
  if (inv === null) {
    return section('memory', [unmeasured('memory.resources', 'memoryInventory', 'count', 'envanter okunamadı')]);
  }
  const metrics: PerfMetric[] = [
    measured({ name: 'memory.jsHeapUsedMb', owner: 'memoryInventory', value: inv.jsHeapUsedMb, unit: 'mb',
      provenance: ['performance.memory — YALNIZ Chromium'] }),
    measured({ name: 'memory.jsHeapLimitMb', owner: 'memoryInventory', value: inv.jsHeapLimitMb, unit: 'mb',
      provenance: ['performance.memory — YALNIZ Chromium'] }),
    measured({ name: 'memory.declaredResources', owner: 'memoryInventory', value: inv.resources.length, unit: 'count',
      provenance: ['bildirilen büyük tüketici'] }),
    measured({ name: 'memory.byteMeasuredResources', owner: 'memoryInventory', value: inv.measuredByteCount, unit: 'count',
      provenance: ['bayt ölçümü OLAN kaynak — dürüstlük göstergesi'] }),
    measured({ name: 'memory.pressureParticipants', owner: 'memoryInventory', value: inv.pressureParticipantCount, unit: 'count',
      provenance: ['memoryWatchdog’a GERÇEKTEN kayıtlı kaynak'] }),
    unmeasured('memory.nativeTotalMb', 'platform', 'mb',
      'native süreç belleği bu fazda ölçülmüyor — ağır native profiler YAZILMADI'),
  ];
  for (const [cls, n] of Object.entries(inv.byClass)) {
    metrics.push(measured({ name: `memory.class.${cls.toLowerCase()}`, owner: 'memoryInventory',
      value: n, unit: 'count', provenance: ['sınıf dağılımı'] }));
  }
  return section('memory', metrics, inv.notes);
}

function memoryPressureSection(): PerfSection {
  const ev = safe(() => getMemoryTrimEvidence(), null);
  if (ev === null) {
    return section('memory_pressure', [
      unmeasured('memory.trimLevel', 'memoryWatchdog', 'none', 'kanıt okunamadı'),
    ]);
  }
  const metrics: PerfMetric[] = [
    measured({ name: 'memory.participants', owner: 'memoryWatchdog',
      value: ev.participantCount, unit: 'count',
      provenance: ['baskı merdivenine KAYITLI kaynak'] }),
    measured({ name: 'memory.participantsWithMeasuredBytes', owner: 'memoryWatchdog',
      value: ev.measuredByteParticipants, unit: 'count',
      provenance: ['bayt ölçümü OLAN katılımcı — dürüstlük göstergesi'] }),
    measured({ name: 'memory.ladderSteps', owner: 'memoryWatchdog',
      value: ev.ladder.length, unit: 'count', provenance: ['kademe sayısı'] }),
    measured({ name: 'memory.trimActionsTotal', owner: 'memoryWatchdog',
      value: ev.participants.reduce((a, r) => a + r.trimCount, 0), unit: 'count',
      provenance: ['oturumda uygulanan trim eylemi'] }),
    measured({ name: 'memory.lastPressureAt', owner: 'memoryWatchdog',
      value: ev.lastPressureAt, unit: 'ms', provenance: ['son baskı olayı (duvar saati)'] }),
  ];
  for (const r of ev.participants) {
    metrics.push(measured({
      name: `memory.participant.${r.id}`, owner: r.owner,
      /* Ölçülemeyen bayt `null` KALIR — 0 YAZILMAZ. Sıfır bayt "yer açmaz"
         demektir; bilinmeyen ise "ne kadar açacağını bilmiyoruz" demektir. */
      value: r.estimatedBytes, unit: 'bytes',
      provenance: [r.participantClass, `kademe: ${r.trimLevel}`,
        `yeniden kurulum: ${r.rebuildCost}`, `trim: ${r.trimCount}`],
    }));
  }
  return section('memory_pressure', metrics, [
    `şu anki kademe: ${ev.currentLevel}`,
    'NON_EVICTABLE_TRUTH bir katılımcı OLAMAZ — kaydedilmeyen şey silinemez (yapısal koruma).',
    'estimatedBytes null olan katılımcı, aynı kademedeki ölçülmüşlerden SONRA çağrılır.',
    'Baskı bir ARIZA DEĞİLDİR: kademe yükselmesi `reportFailure` üretmez (yalnız CRITICAL’de mevcut davranış korunur).',
  ]);
}

function storageDurabilitySection(): PerfSection {
  const reasons = safe(() => getStorageWriteReasons(), null);
  const emmc = safe(() => getEmmcWriteCount(), null);
  if (reasons === null) {
    return section('storage_durability', [
      unmeasured('storage.flushReasons', 'safeStorage', 'count', 'kanıt okunamadı'),
    ]);
  }
  const metrics: PerfMetric[] = Object.entries(reasons).map(([r, n]) => measured({
    name: `storage.flush.${r.toLowerCase()}`, owner: 'safeStorage',
    value: n, unit: 'count', provenance: ['yazımın GEREKÇESİ'],
  }));
  if (emmc !== null) {
    metrics.push(measured({ name: 'storage.emmcWrites', owner: 'safeStorage',
      value: emmc.count, unit: 'count', sampleWindowMs: emmc.sinceMs,
      provenance: ['gerçek disk yazma sayısı'] }));
  }
  return section('storage_durability', metrics, [
    'Debounce penceresi (5 s) DEĞİŞMEDİ — uzatmak veri kaybı penceresini büyütürdü.',
    'CRITICAL_SYNC double-lock yolu AYNEN duruyor.',
    'Anahtar DEĞERİ ve kullanıcı içeriği sayaca GİRMEZ.',
  ]);
}

/* ── ARCH-06/F6 · birleşik degradasyon tavanı (SALT KANIT) ────────────────
   L7 projeksiyonunun ne KARAR verdiğini gösterir. LAB burada hesaplama
   YAPMAZ — projeksiyonu olduğu gibi okur (LAB ikinci otorite olamaz). */
function workloadCeilingSection(): PerfSection {
  const proj = safe(() => getWorkloadCeilings(), null);
  if (proj === null) {
    return section('workload_ceilings', [
      unmeasured('ceiling.projection', 'workloadCeilings', 'none', 'projeksiyon okunamadı'),
    ]);
  }
  const order = safe(() => workloadOrder(), []);
  const rank = (c: string): number => (c === 'FULL' ? 0 : c === 'REDUCED' ? 1 : c === 'MINIMAL' ? 2 : 3);
  const metrics: PerfMetric[] = order.map((id, idx) => derived({
    name: `ceiling.${id}`, owner: 'workloadCeilings',
    /* Tavan bir SAYI değildir; kademe indeksi olarak yayınır
       (0=FULL … 3=OFF) — adı provenance'ta açık yazılır. */
    value: rank(proj.ceilings[id]), unit: 'count',
    provenance: [proj.ceilings[id], `feda sırası: ${idx + 1}/${order.length}`],
  }));
  const inp = proj.inputs;
  metrics.push(derived({ name: 'ceiling.thermalLevel', owner: 'thermalWatchdog',
    value: inp.thermalLevel, unit: 'count', provenance: ['L7 girdisi — sahibi thermalWatchdog'] }));
  metrics.push(derived({ name: 'ceiling.workerLifecycleActive', owner: 'AdaptiveRuntimeManager',
    value: inp.workerLifecycle?.active ?? null, unit: 'count',
    provenance: ['yalnız KANIT — doygunluk ÖLÇÜLMÜYOR, karara girmez'] }));
  metrics.push(unmeasured('ceiling.workerSaturation', 'AdaptiveRuntimeManager', 'none',
    'kuyruk derinliği ölçülmüyor — sahte doygunluk üretilmez'));

  const tier = safe(() => getObservedTierEvidence(), null);
  const hyst = safe(() => getHysteresisContract(), null);
  if (tier !== null) {
    metrics.push(derived({ name: 'ceiling.tierSampleCount', owner: 'perfSeriesRecorder',
      value: tier.sampleCount, unit: 'count', provenance: ['gözlem için mevcut örnek adedi'] }));
    metrics.push(unmeasured('ceiling.observedTier', 'workloadCeilings', 'none', tier.reason));
  }
  if (hyst !== null && hyst.calibration === 'UNCALIBRATED') {
    metrics.push(unmeasured('ceiling.hysteresisThresholds', 'workloadCeilings', 'count',
      'UNCALIBRATED — saha tabanı alınmadan eşik sayısı yazılmaz'));
  }

  /* F7 — tavanı KİMİN uyguladığı. Bir kategori "kısıtlı" görünüp aslında
     hiçbir tüketici tarafından okunmuyorsa, bu SAHTE bir kazanç iddiasıdır;
     satır bunu görünür kılar. */
  const owners = safe(() => ceilingOwnership(), []);
  for (const o of owners) {
    metrics.push(unmeasured(`ceiling.enforcer.${o.workload}`, 'workloadCeilings', 'none',
      `${o.enforcer}${o.consumer === null ? '' : ` → ${o.consumer}`}`));
  }
  const bound = safe(() => boundWorkloads(), []);
  metrics.push(derived({ name: 'ceiling.boundWorkloads', owner: 'workloadCeilings',
    value: bound.length, unit: 'count',
    provenance: ['tavanı GERÇEKTEN bir tüketicinin okuduğu kategori sayısı',
      `${bound.length}/${order.length}`] }));

  return section('workload_ceilings', metrics, [
    `baskın kaynak: ${proj.dominantSource}`,
    `mod: ${inp.runtimeMode ?? 'UNKNOWN'} · termal: ${inp.thermalLevel ?? 'UNKNOWN'} · `
      + `bellek: ${inp.memoryLevel ?? 'UNKNOWN'} · sınıf: ${inp.deviceTier ?? 'UNKNOWN'}`,
    ...proj.notes,
    'observedTier staticTier’ı OTOMATİK DEĞİŞTİRMEZ — uyuşmazlık yalnız kanıttır.',
    'Cihaz MODELİ / SKU LAB’a TAŞINMAZ — yalnız türetilmiş sınıf.',
  ]);
}

/* ── ARCH-06/F7 · LAB örneklemesi ve KAPALI davranışı ────────────────────
   LAB'ın kendi maliyetini LAB'da göstermek bilinçli bir seçimdir: gözlem
   yüzeyi ölçülmeden "ucuz" varsayılamaz. */
function labSamplingSection(counters: PerfCounterSnapshot): PerfSection {
  /* ⚠️ BAĞIMLILIK YÖNÜ: bu bölüm LAB runtime'ını IMPORT ETMEZ. Yön daima
     domain/LAB → perf'tir; tersi, LAB prob grafiğini (gpsService ·
     navigationService · pollCost …) perf katmanına bağlardı. Sayılar
     `perfCounters` (sıfır-import yaprak modül) üzerinden okunur. */
  const ran = counters['lab.autoRefreshRan'];
  const skipped = counters['lab.autoRefreshSkipped'];
  const ceiling = safe(() => ceilingFor('labSampling'), null);
  const metrics: PerfMetric[] = [
    measured({ name: 'lab.autoTicks', owner: 'carosLabRefreshRuntime',
      value: ran + skipped, unit: 'count', provenance: ['otomatik tur tik sayısı'] }),
    measured({ name: 'lab.autoRan', owner: 'carosLabRefreshRuntime',
      value: ran, unit: 'count', provenance: ['tavanın İZİN VERDİĞİ tur'] }),
    measured({ name: 'lab.autoSkipped', owner: 'carosLabRefreshRuntime',
      value: skipped, unit: 'count', provenance: ['tavanın ATLATTIĞI tur'] }),
    derived({ name: 'lab.autoCeiling', owner: 'workloadCeilings',
      value: null, unit: 'none',
      provenance: [`labSampling tavanı: ${ceiling ?? 'UNKNOWN'}`] }),
  ];
  return section('lab_sampling', metrics, [
    'ELLE YENİLE tavandan ETKİLENMEZ — kullanıcı niyeti kısılmaz.',
    'LAB kapalı: timer STOPPED · abonelik DETACHED · yoklama NOT_INVOKED · '
      + 'üretim etkisi NONE (sözleşme: carosLabRefreshRuntime.LAB_CLOSED_BEHAVIOR).',
    'Bu bölüm LAB runtime’ını import ETMEZ — bağımlılık yönü LAB → perf.',
  ]);
}

/* ── ARCH-06/F7 · Mavi bağlam iş yükü (YALNIZ ÖLÇÜM) ────────────────────
   Bütçe DEĞİŞTİRİLMEDİ; burada yalnız "ne kadar iş yapılıyor" görünür.
   GİZLİLİK: alan adı/değeri, kullanıcı metni, araç kimliği YOK — yalnız adet. */
function maviContextSection(counters: PerfCounterSnapshot, windowMs: number | null): PerfSection {
  const metrics = counterMetrics(counters, windowMs, [
    ['mavi.contextBuildAttempt', 'bağlam kurma denemesi (her sohbet çağrısı)'],
    ['mavi.contextInjected', 'prompt’a GERÇEKTEN eklenen bağlam'],
    ['mavi.contextSkipped', 'şalter/izin/boş/hata nedeniyle eklenmeyen'],
    ['mavi.contextFieldsKept', 'taşınan alan (kümülatif)'],
    ['mavi.contextFieldsDropped', 'bütçe nedeniyle düşen alan (kümülatif)'],
    ['mavi.contextFieldsStale', 'BAYAT olduğu işaretlenerek taşınan alan'],
  ]);
  const attempts = counters['mavi.contextBuildAttempt'];
  const kept = counters['mavi.contextFieldsKept'];
  const dropped = counters['mavi.contextFieldsDropped'];
  metrics.push(derived({ name: 'mavi.contextAvgFields', owner: 'contextSerializer',
    value: attempts > 0 ? kept / attempts : null, unit: 'count',
    provenance: ['çağrı başına taşınan ortalama alan'] }));
  /* Bütçe BASKISI: düşen alan oranı. Yüksekse bütçe dar demektir — ama bu
     bir HÜKÜM değil, bir GÖZLEMDİR; bütçe kararı sahada alınır. */
  metrics.push(derived({ name: 'mavi.contextDropRatio', owner: 'contextSerializer',
    value: (kept + dropped) > 0 ? dropped / (kept + dropped) : null, unit: 'ratio',
    provenance: ['bütçe nedeniyle düşen alan oranı'] }));
  return section('mavi_context', metrics, [
    'Bağlam bütçesi (maxChars 700 · maxFields · öncelik sırası) DEĞİŞTİRİLMEDİ.',
    'Ölçüm sohbeti ASLA düşürmez: sayaç yolu try/catch içindedir.',
    'Alan ADI, alan DEĞERİ, kullanıcı metni ve araç kimliği sayaca GİRMEZ.',
    'Mavi bir REQUESTER’dır — bu bölüm Mavi’ye truth sahipliği VERMEZ.',
  ]);
}

function instrumentationSection(counters: PerfCounterSnapshot, windowMs: number | null): PerfSection {
  return section('instrumentation', [
    measured({ name: 'instrumentation.t0.counterCount', owner: OWNER_COUNTERS,
      value: perfCounterIds().length, unit: 'count',
      provenance: ['T0 — daima açık tamsayı sayaç adedi'] }),
    measured({ name: 'instrumentation.t0.totalBumps', owner: OWNER_COUNTERS,
      value: perfCounterIds().reduce((a, id) => a + counters[id], 0), unit: 'count',
      provenance: ['tüm T0 artırımlarının toplamı — enstrümantasyon iş yükü vekili'] }),
    derived({ name: 'instrumentation.t0.bumpRate', owner: OWNER_COUNTERS,
      value: ratePerSec(perfCounterIds().reduce((a, id) => a + counters[id], 0), windowMs),
      unit: 'per_sec', sampleWindowMs: windowMs,
      provenance: ['saniyede kaç tamsayı artırımı — T0 maliyetinin ÜST sınırı'] }),
    measured({ name: 'instrumentation.sessionWindowMs', owner: OWNER_COUNTERS,
      value: windowMs, unit: 'ms', provenance: ['sayaçların açık olduğu süre'] }),
    unmeasured('instrumentation.overheadMs', 'platform', 'ms',
      'enstrümantasyonlu ↔ enstrümantasyonsuz karşılaştırma AYRI bir baseline koşumudur (F1 çıkış kapısı)'),
  ], [
    'T0 = daima açık tamsayı sayaç · T1 = 12 s kaydedici · T2 = YALNIZ LAB açıkken bu projeksiyon.',
    'Bu fonksiyonun KENDİSİ T2’dir: LAB kapalıyken çağrılmaz.',
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════
   5) TOPLAMA
   ══════════════════════════════════════════════════════════════════════════ */

export interface PerformanceDiagnosticsSnapshot {
  readonly sections: readonly PerfSection[];
  readonly capturedAt: number | null;
  /** Ölçülmüş metrik / toplam metrik — "ne kadarını görebiliyoruz". */
  readonly measuredMetricCount: number;
  readonly totalMetricCount: number;
  readonly provenance: readonly string[];
}

/**
 * TEK GİRİŞ NOKTASI — salt-okunur performans anlık görüntüsü.
 *
 * Yan etkisi YOKTUR: sayaç sıfırlamaz, timer kurmaz, servis başlatmaz,
 * cache boşaltmaz, mod değiştirmez, benchmark koşturmaz.
 */
export function getPerformanceDiagnosticsSnapshot(): PerformanceDiagnosticsSnapshot {
  const counters = safe(() => getPerfCounters(), {} as PerfCounterSnapshot);
  const windowMs = safe(() => sessionWindowMs(), null);

  const sections: PerfSection[] = [
    bootSection(),
    bootServicesSection(),
    bootDeferralSection(),
    renderSection(),
    longTaskAttributionSection(),
    bridgeSection(counters, windowMs),
    bridgePolicySection(),
    canVdlSection(counters, windowMs),
    obdSection(),
    gpsSection(counters, windowMs),
    mapSection(counters, windowMs),
    renderClassSection(),
    storageSection(counters, windowMs),
    artworkSection(counters),
    timerSection(),
    memorySection(),
    memoryPressureSection(),
    storageDurabilitySection(),
    workloadCeilingSection(),
    labSamplingSection(counters),
    maviContextSection(counters, windowMs),
    instrumentationSection(counters, windowMs),
  ];

  let total = 0;
  let measuredCount = 0;
  for (const s of sections) {
    for (const m of s.metrics) {
      total += 1;
      if (m.kind !== 'UNMEASURED') measuredCount += 1;
    }
  }

  return Object.freeze({
    sections: Object.freeze(sections),
    capturedAt: perfNow(),
    measuredMetricCount: measuredCount,
    totalMetricCount: total,
    provenance: Object.freeze([
      'performanceAggregator.getPerformanceDiagnosticsSnapshot()',
      'sahipler: bootTimingRecorder · perfSeriesRecorder · perfCounters · timerInventory · memoryInventory',
      'YAZMA YOK — bu projeksiyon hiçbir sahibin durumunu değiştirmez',
    ]),
  });
}
