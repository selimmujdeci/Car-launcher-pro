/**
 * carosLabCopySources.ts — "TÜMÜNÜ KOPYALA" için TEK okuma noktası (fail-soft).
 *
 * SÖZLEŞME (A3'teki `sessionInspectorSources` deseninin aynısı):
 *  - YALNIZ mevcut SENKRON getter'lar çağrılır. Yeni servis · abonelik · timer ·
 *    native pull · polling · handshake · Deep Scan · komut gönderimi YOKTUR.
 *  - Her kaynak ayrı try/catch: biri patlarsa diğerleri gelir; patlayan kaynak
 *    `null` döner → model onu "okunamadı" diye YAZAR (boş küme VARSAYILMAZ).
 *  - Hiçbir maskeleme burada YAPILMAZ — maskeleme tek yerde, saf modeldedir.
 */

import { CAROS_LAB_TOOLS } from './carosLabCatalog';
import { readSessionRawSnapshot } from './sessionInspectorSources';
import { readSchedRawSnapshot } from './runtimeSchedulingSources';
import { buildEvidenceRows } from './evidenceViewerModel';
import { getDiagnosticTrail } from '../diagnosticTrail';
import { getLastAiMechanicResult } from '../system/platformCoreAiRuntimeWiring';
import { getValidationSnapshot } from '../validation/validationRecorder';
import { discoveryCaptureService } from '../obd/discovery';
import { useDebugStore } from '../debug';
import { getOBDDataSnapshot, getLinkLossLedger } from '../obdService';
import { getReplayData, getCrashDetectionHealth } from '../security/blackBoxService';
import { useHALStatusStore } from '../vehicleDataLayer/halStatusStore';
import { getDevtoolsCaptureStatus } from './devtoolsCapture';
import { getPollEvidenceCacheState } from '../obd/extendedPollEvidence';
import { getErrorLog } from '../crashLogger';
import { getLastPidTimingRaw } from '../obd/pidTimingExperiment';
import { getPollEvidenceRefreshedAt } from '../obd/extendedPollEvidence';
import { getExtendedEliminationRefreshedAt } from '../obd/extendedElimination';
import { getEtaJumpLedger } from '../navigationService';
import { getFixAgeLedger } from '../gpsService';
import { readNavigationCoreSnapshot } from './navigationCoreSources';
import { getTileModeVerdict } from '../mapSourceManager';
import { buildPidTimingReport } from '../obd/pidTimingExperimentModel';
import type { CarosLabCopyInput } from './carosLabCopyModel';

/** T10: LAB'a taşınan azami hata kaydı (bounded — tavan korunur). */
const ERROR_LOG_MAX = 60;

/**
 * T10: hata kurtarılabilir bir sınıfa mı ait — bağlam önekinden türetilir.
 * Bilinmeyen sınıf `false` döner (fail-closed: "kurtarılabilir" iddiası kanıt ister).
 */
function _isRecoverableError(ctx: string): boolean {
  const head = ctx.split(':')[0];
  return head === 'OBD' || head === 'GPS' || head === 'HealthMonitor' || head === 'Resolver';
}

/** `fn` çalışırsa sonucu, patlarsa `null` (→ "okunamadı" beyanı). */
function safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

export interface CopyContext {
  readonly generatedAtWallMs: number;
  readonly platform:   string;
  readonly appVersion: string | null;
  readonly category:   string;
  readonly activeTool: string | null;
}

/** Tüm salt-okunur kaynakları TEK seferde okur. TIMER YOK, ABONELİK YOK. */
export function readCarosLabCopyInput(ctx: CopyContext): CarosLabCopyInput {
  return {
    meta: {
      generatedAtWallMs: ctx.generatedAtWallMs,
      platform:          ctx.platform,
      appVersion:        ctx.appVersion,
      category:          ctx.category,
      activeTool:        ctx.activeTool,
      /* Yan etkisiz ref-sayaç okuması — kanal AÇMAZ/KAPATMAZ. */
      captureRefs: safe(() => {
        const s = getDevtoolsCaptureStatus();
        return { obd: s.obdRefs, can: s.canRefs };
      }),
      /* S2 (#505): kanıt önbelleğinin TAZELİK durumu — saf bayrak okuması, native pull YOK
         (bu yol senkron kalmalıdır; `refreshExtendedPollEvidence()` BİLEREK çağrılmaz).
         Model bunu raporun başına uyarı olarak basar: "ölçmedik" ≠ "poll ölü". */
      pollEvidenceCacheState: safe(() => getPollEvidenceCacheState()),
    },
    /* `ad` alan adı BİLEREK seçildi: `name` gizlilik deny-list'inde olduğu için
       her derinlikte düşürülüyordu → saha çıktısında araç adları HİÇ görünmedi. */
    catalog: safe(() =>
      CAROS_LAB_TOOLS.map((t) => ({ id: t.id, ad: t.name, category: t.category, status: t.status }))),
    session:    safe(() => readSessionRawSnapshot() as unknown),
    scheduling: safe(() => readSchedRawSnapshot() as unknown),
    evidence: safe(() => buildEvidenceRows({
      trail:      safe(() => getDiagnosticTrail()),
      aiResult:   safe(() => getLastAiMechanicResult()),
      validation: safe(() => getValidationSnapshot()),
    }) as readonly unknown[]),
    obdTraffic: safe(() => useDebugStore.getState().obdTrafficLog as CarosLabCopyInput['obdTraffic']),
    canRaw:     safe(() => useDebugStore.getState().canRawLog as CarosLabCopyInput['canRaw']),
    discovery:  safe(() => discoveryCaptureService.getObservations() as readonly unknown[]),
    obdData:    safe(() => getOBDDataSnapshot() as unknown),
    blackBox:   safe(() => getReplayData() as readonly unknown[]),
    /**
     * T10 — HATA KÜTÜĞÜ artık CANONICAL otoriteden beslenir.
     *
     * ESKİ KUSUR: kaynak `debugStore.errorLog` idi; onu besleyen `dbgPushError`in
     * uygulama içinde HİÇ ÇAĞIRANI YOK (ölü kanal). Gerçek hatalar `logError()` →
     * `crashLogger` kütüğüne yazılıyor ve `diagnosticTrail` bunları `trail:error`
     * olarak ZATEN oradan türetiyordu. Yani iki paralel hata sistemi vardı; biri
     * yapısal olarak boş, diğeri dolu. Artık TEK otorite `getErrorLog()`tur —
     * köprü eklenmedi, ölü kanal kaynak olmaktan çıkarıldı (çift yazım imkânsız).
     *
     * Yapılandırılmış alanlar korunur; `stack` ve `replayBuffer` LAB'a TAŞINMAZ
     * (gizlilik + tavan). `recoverable`: kurtarma yolu olan hata sınıfları.
     */
    errorLog:   safe(() => getErrorLog().slice(-ERROR_LOG_MAX).map((e) => ({
      ts:          e.ts,
      code:        String(e.ctx).split(':')[0] || 'UNKNOWN',
      component:   String(e.ctx),
      source:      'crashLogger',
      severity:    e.severity ?? 'error',
      message:     String(e.msg).slice(0, 200),
      recoverable: _isRecoverableError(String(e.ctx)),
      correlationId: `err-${e.ts}-${String(e.ctx).slice(0, 24)}`,
    })) as readonly unknown[]),
    /* HAL kaynak sağlığı: `canAlive/obdAlive/gpsAlive` — **null = BİLİNMİYOR**, false = ÖLÜ.
       `updatedAt` worker MONOTONİK saatidir (performance.now()), duvar saati DEĞİL →
       `Date.now()` ile bayatlık hesaplamak YANLIŞ olur; ham geçirilir, yorumlanmaz. */
    sourceHealth: safe(() => useHALStatusStore.getState().sourceHealth as unknown),
    crashDetection: safe(() => getCrashDetectionHealth() as unknown),
    /* #526 — NATIVE SAYAÇ SNAPSHOT'LARININ YAŞI. Kopyadaki `lastPollAt` 5 dk 17 sn
       bayat görünüp "extended poll durdu" sanıldı; poll durmamıştı, ÖNBELLEK eskiydi
       (kopya yolu senkrondur, async tazelemeyi ÇAĞIRAMAZ). Yaş olmadan okuyucu bunu
       ayırt edemez → artık raporun kendisi söylüyor. */
    nativeSnapshotAge: safe(() => {
      const now = Date.now();
      const age = (at: number | null) => (at === null ? null : Math.max(0, now - at));
      return {
        aciklama: 'Bu değerler native ÖNBELLEKTEN okunur; önbelleği yalnız ilgili LAB '
                + 'ekranı açıldığında yapılan async çağrı doldurur. Yaş büyükse sayılar '
                + 'ESKİ bir andan gelir — "poll durdu" ANLAMINA GELMEZ.',
        pollKanitiYasMs: age(getPollEvidenceRefreshedAt()),
        elemeYasMs:      age(getExtendedEliminationRefreshedAt()),
      } as unknown;
    }),
    /* ── #535 · NAVİGASYON ÖLÇÜMÜ KOPYAYA GİRER ─────────────────────────────
       SAHA (2026-08-11): saha koşumu yapıldı ama kopyada NE `fixAgeMs` (#508)
       NE ETA sıçrama defteri (#530) vardı → ölçüm alınamadı, yolculuk boşa gitti.
       #523'te H-A deneyi için düzelttiğim kusurun BİREBİR AYNISI: ölçüm yazıldı,
       dışarı çıkarılmadı. İki kaynak da senkron okunur (kopya sözleşmesi). */
    navigationCore: safe(() => {
      const n = readNavigationCoreSnapshot();
      /* Her getter kendi try/catch'inde — karo hükmü okunamazsa nav ölçümü
         yine de kopyaya girer (fail-soft, kopya sözleşmesi). */
      const tileVerdict = (() => { try { return getTileModeVerdict(); } catch { return null; } })();
      return {
        /* ⚠️ #537 DÜZELTMESİ: bu alan EŞLEŞTİRİLMİŞ (map-match) fix'in yaşıdır ve
           nav aktif değilken tazelenmez. Sahada (2026-08-11) `fixAgeMs: 5237`
           #508 kanıtı sanıldı — oysa #508 KONUM SAĞLAYICISININ yaşını ister.
           Doğru sayı artık `konumFixYasMs` alanındadır (G1 tek otoritesinden). */
        fixAgeMs:          n.fixAgeMs,
        konumFixYasMs:     n.locationFixAgeMs,
        konumBayat:        n.locationStale,
        konumKaynagi:      n.locationSource,
        hasRawFix:         n.hasRawFix,
        gpsObservedAtWall: n.gpsObservedAtWall,
        navStatus:         n.navStatus,
        etaSeconds:        n.etaSeconds,
        routeRevision:     n.routeRevision,
        distanceSource:    n.nextManeuverDistanceSource,
        mapMatchState:     n.mapMatchState,
        /* ── #640 · "HARİTA NEDEN GRİ?" TEK YAPIŞTIRMAYLA CEVAPLANSIN ────────
           SAHA (2026-08-19): kullanıcı gri-üstüne-gri harita bildirdi; ekran
           pikselinden yol↔zemin **1,21:1** ölçüldü (vektör merdiveni 3,04–8,00).
           Sebep raster'a düşülmesiydi — ama TAM KOPYADA ne çözülen karo modu
           ne sebebi vardı; gönderilen tam dökümden teşhis ÇIKARILAMADI.
           `getResolvedTileMode()` NİYETİ değil GERÇEĞİ taşır (#637). */
        haritaKaroModu:    tileVerdict?.resolved  ?? 'UNKNOWN',
        haritaKaroNiyeti:  tileVerdict?.intent    ?? 'UNKNOWN',
        haritaRasterSebebi: tileVerdict?.reason   ?? null,
        haritaModu:        tileVerdict?.mapMode   ?? 'UNKNOWN',
        haritaTermalKilit: tileVerdict?.thermalLock ?? null,
        haritaArAktif:     tileVerdict?.arActive    ?? null,
        haritaVektorKapisiKapali: tileVerdict?.vectorGateBlocked ?? null,
        cihazSinifi:       tileVerdict?.deviceTier ?? 'UNKNOWN',
      } as unknown;
    }),
    /* ── #537 · FIX YAŞI DAĞILIMI (GÖREV B — #508'İN KAPANIŞ ŞARTI) ─────────
       SAHA (2026-08-11): kopyada tek anlık `fixAgeMs: 5237` vardı; #508 ise
       `p50<3s ∧ p95<10s` DAĞILIMI ister → ölçüm kapanış üretemedi. Dağılım
       artık kopyada: p50/p95/min/max + örnek sayısı + hüküm + ÖRNEKLEME MODELİ.
       Okuma ucu örnek ALMAZ → kopya almak dağılımı kirletmez. */
    fixAgeDistribution: safe(() => {
      const l = getFixAgeLedger();
      return {
        aciklama: 'Örnekler tüketici okumasında alınır (yeni timer YOK) → zaman ekseninde '
                + 'DÜZGÜN dağılım İDDİA EDİLMEZ; yanlılık okuma aralığı yüzdelikleriyle '
                + 'görünür. #508\'in üçüncü ölçütü (iz/gerçek yol) bu defterde ÖLÇÜLMEZ.',
        ozet: l.summary,
      } as unknown;
    }),
    /* ── #536 · KOPMA KANIT DEFTERİ (GÖREV A) ───────────────────────────────
       SAHA (2026-08-11): 8 timeout · LinkLost 47 s · quality %57 ölçüldü ama
       KÖK NEDEN ayırt edilemedi (dört aday aynı `timeout` sayısını üretiyor).
       Defter kopma anındaki imzayı + kurtarma imzasını taşır. `records`
       bounded (24) ve PII taşımaz; `summary.nextMeasurement` bir sonraki turun
       ölçüm işini söyler. KİLİT 30 dersi: ölçüm AYNI PR'da kopyaya girer. */
    linkLosses: safe(() => {
      const l = getLinkLossLedger();
      return { summary: l.summary, records: l.records } as unknown;
    }),
    /* #530 — ETA sıçrama defteri: hangi anahtarın sıçramaya eşlik ettiği.
       `records` bounded (40) ve PII taşımaz; `summary` baskın tetikleyiciyi verir. */
    etaJumps: safe(() => {
      const l = getEtaJumpLedger();
      return { summary: l.summary, records: l.records } as unknown;
    }),
    /* #523 — H-A DENEYİ. Ham örnekler TAŞINMAZ (yüzlerce satır, kopya tavanını
       yer); yalnız HÜKÜM + KANIT + BULGULAR + aşama/PID ÖZETİ gider. Rapor saf
       modelden üretilir → kopyadaki sayı ile ekrandaki sayı AYNI kaynaktan gelir,
       ikinci bir hesap doğmaz. Ekran hiç okunmadıysa `null` (uydurma YOK). */
    pidTimingExperiment: safe(() => {
      const cached = getLastPidTimingRaw();
      if (cached === null) return null;
      const rep = buildPidTimingReport(cached.raw);
      return {
        okunmaZamani:   cached.readAtMs,
        durum:          rep.status,
        hukum:          rep.verdict,
        hukumNotu:      rep.verdictNote,
        atstUygulandi:  rep.atstApplied,        // null = ÖLÇÜLEMEDİ
        kanitYolu:      rep.atstEvidenceMethod,
        kanitOrani:     rep.atstEvidenceRatio,
        kanitMutlakMs:  rep.atstEvidenceAbsMs,
        atstGeriAlindi: rep.stRestored,
        bulgular:       rep.notableFindings,
        asamalar:       rep.totals.map((t) => ({
          asama: t.phase, atst: t.stApplied, atstOk: t.stCommandOk,
          deneme: t.attempts, noData: t.noData, basari: t.success, diger: t.other,
          noDataOrani: t.noDataRate, basariOrani: t.successRate,
          basariMs: t.successMs, noDataMs: t.noDataMs, digerMs: t.otherMs,
          kuyrukMs: t.queueWaitMs, okumaTavaniMs: t.readDeadlineMs,
          asamaSuresiMs: t.wallMs, baglantidanMs: t.sinceConnectMs,
        })),
        pidler: rep.perPid.map((p) => ({
          pid: p.pid, hedef23: p.pid === '23', hukum: p.verdict,
          aNoData: p.a?.noDataRate ?? null, bNoData: p.b?.noDataRate ?? null,
          a2NoData: p.a2?.noDataRate ?? null,
          aOkP95: p.a?.successMs.p95 ?? null, bOkP95: p.b?.successMs.p95 ?? null,
        })),
      } as unknown;
    }),
  };
}
