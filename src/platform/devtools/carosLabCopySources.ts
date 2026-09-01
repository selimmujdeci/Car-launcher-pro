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
import {
  getTraceEvents, getDroppedEventCount, summarizeTrace, getTraceId,
} from '../obd/canonicalTrace';
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
import { getEcuObservations, ECU_ADDRESSABILITY_LABEL } from '../obd/ecuAddressability';
import { getLastEcuCompleteness, getKwpDtcEvidence } from '../obd/multiEcuScan';
import { getKwpSessionProbes, KWP_SESSION_RESULT_LABEL } from '../obd/kwpSessionProbe';
import {
  getKwpAddressingProbes, KWP_ADDRESSING_RESULT_LABEL,
} from '../obd/kwpAddressingProbe';
import { getErrorLog } from '../crashLogger';
import { getLastPidTimingRaw } from '../obd/pidTimingExperiment';
import { getPollEvidenceRefreshedAt } from '../obd/extendedPollEvidence';
import { getExtendedEliminationRefreshedAt } from '../obd/extendedElimination';
import { getEtaJumpLedger } from '../navigationService';
import { getFixAgeLedger } from '../gpsService';
import { readNavigationCoreSnapshot } from './navigationCoreSources';
import {
  describeGpsAuthorities, explainGpsAuthorityDivergence,
} from '../gps/gpsHealthReconcile';
import { getConnectivitySnapshot } from '../canBus/VehicleConnectivityManager';

/**
 * D — kopyanın GPS fix TAZELİK penceresi (ms).
 *
 * `gpsHealthReconcile` saf modeldir ve pencereyi ÇAĞIRANDAN alır; kopya kendi
 * eşiğini UYDURMAZ, `obdService` veri tazelik penceresiyle aynı mertebeyi
 * (#508 kabul ölçütü: p95 < 10 sn) kullanır. Bu bir KARAR eşiği değildir —
 * yalnız "taze / bayat" etiketidir ve ürün davranışına GERİ BESLENMEZ.
 */
const GPS_COPY_FIX_FRESH_WINDOW_MS = 10_000;
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
        /* D — İKİ YAŞ ALANI AYNI ŞEYİ ÖLÇMEZ; kopya bunu artık KENDİSİ söyler
           (saha 2026-08-30: `fixAgeMs:null` + `konumFixYasMs:735` çelişki sanıldı). */
        yasAlanlariAciklama:
          'fixAgeMs = MAP-MATCHED fix yaşı — nav AKTİF DEĞİLKEN tazelenmez, '
        + 'null burada ARIZA DEĞİL "rota yok" demektir. '
        + 'konumFixYasMs = KONUM SAĞLAYICISININ fix yaşı (G1 tek otoritesi) — '
        + '#508 kabul ölçütü BU alanı ister. İkisi karşılaştırılmaz.',
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
        /* ── 2026-08-24 · "bazen gri bazen koyu" (rota bittikten sonra) ────
           `resolved`/`intent` senkron olsa bile GECE yanlış çözülürse harita
           ham OSM (RASTER_PAINT_DAY) gibi açık/jenerik görünür — bu iki alan
           OLMADAN o teşhis kopyadan ÇIKARILAMAZ (aynı sınıf boşluk, #640 ile
           AYNI ders). `haritaNiyetSenkronsuz` niyet≠çözülen anını tek bakışta
           işaretler (kalıcı desync gözlemi — ölçüm için timer YOK). */
        haritaGeceEtkin:   tileVerdict?.mapNight ?? null,
        haritaGeceIstenen: tileVerdict?.mapNightRequested ?? null,
        haritaNiyetSenkronsuz: tileVerdict?.intentResolvedMismatch ?? null,
      } as unknown;
    }),
    /* ── P0-VDK-F2A · KANONİK İZ ÖZETİ ─────────────────────────────────────
       TAM KOPYA'ya izin BÜTÜNÜ değil ÖZETİ girer: yüzlerce ham olayı metne
       basmak kopyayı kullanılamaz kılardı. Ama SESSİZ KIRPMA YOK — olay
       adedi, düşen sayısı, boşluk/tekrar ve export engeli AÇIKÇA yazılır;
       tam paket ayrı bir export dosyasıdır (`traceExport`). */
    tanIzi: safe(() => {
      const t = summarizeTrace(getTraceEvents(), getDroppedEventCount(), getTraceId());
      return {
        izKimligi:      t.traceId,
        olaySayisi:     t.integrity.eventCount,
        islemSayisi:    t.transactionCount,
        hamKapsam:      t.rawCoverage,
        maskeliOlay:    t.redactedCount,
        maskelenmemis:  t.notRedactedCount,
        siraBoslugu:    t.integrity.gaps.length,
        tekrarliSira:   t.integrity.duplicates.length,
        dusenOlay:      t.integrity.droppedCount,
        kirpildi:       t.integrity.truncated,
        hamOlcumsuz:    t.integrity.missingRawCount,
        exportHazir:    t.exportReady,
        exportEngeli:   t.exportBlockReason,
        not: 'TAM KOPYA yalnız ÖZET taşır; olayların tamamı ayrı iz paketindedir.',
      };
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
    /* ── P0-OBD-FINAL-02 · ECU KEŞİF / ADRESLENEBİLİRLİK KANITI ─────────────
       SAHA (2026-08-25 · Protocol 5 / KWP): ekranda `ECU 7A (KWP)` · rx
       `86F17A` · tx `817AF1` · 8-bit · rol UNKNOWN GÖRÜNÜYORDU, ama "TÜMÜNÜ
       KOPYALA" çıktısında bu kanıt HİÇ YOKTU → gönderilen tam dökümden teşhis
       ÇIKARILAMIYORDU. Bu, #535/#523 ile AYNI SINIF kusurdur: ölçüm yapıldı,
       dışarı çıkarılmadı.

       KANONİK KAYNAKLAR KULLANILIR — ikinci paralel state KURULMAZ:
         · `getEcuObservations()`      → ecuAddressability defteri
         · `getLastEcuCompleteness()`  → ecuCompleteness kanıtı (tarama yazar)
         · `getKwpSessionProbes()`     → kwpSessionProbe defteri
         · `getKwpDtcEvidence()`       → 0x18 kapısının son tur kanıtı
       Her getter kendi try/catch'inde: biri patlarsa diğerleri yine gelir. */
    ecuDiscovery: safe(() => {
      const observations = (() => { try { return getEcuObservations(); } catch { return null; } })();
      const completeness = (() => { try { return getLastEcuCompleteness(); } catch { return null; } })();
      const sessionProbes = (() => { try { return getKwpSessionProbes(); } catch { return null; } })();
      const kwpGate = (() => { try { return getKwpDtcEvidence(); } catch { return null; } })();
      const addressing = (() => { try { return getKwpAddressingProbes(); } catch { return null; } })();
      return {
        aciklama: 'ECU adresleri ve protokol hanesi OBD verisidir (PII değildir). '
                + 'UNKNOWN ile NOT_ADDRESSABLE AYRI anlamlıdır: biri "sorulamadı", '
                + 'diğeri "soruldu, ulaşılamadı". Boş defter "ECU yok" DEMEK DEĞİLDİR '
                + '— tam araç taraması bu oturumda hiç koşmamış olabilir.',
        /* null = getter patladı; boş dizi = defter GERÇEKTEN boş (ayrım korunur). */
        gozlemler: observations === null ? null : observations.map((o) => ({
          oturum:        o.sessionEpoch,
          protokol:      o.protocol,
          rx:            o.rxHeader,
          tx:            o.txHeader,
          adresBiti:     o.addressBits,
          etiket:        o.label,
          rol:           o.role,
          rolKaniti:     o.roleEvidence,
          kesifKaynagi:  o.discoverySource,
          probSonucu:    o.probeOutcome,
          txProvenance:  o.txProvenance,
          adreslenebilirlik:      o.addressability,
          adreslenebilirlikEtiket: ECU_ADDRESSABILITY_LABEL[o.addressability],
          gerekce:       o.addressabilityReason,
          admisyon:      o.admission,
          kwpHedefDogrulandi: o.kwpTargetVerified,
          otoriteYayini: o.publishedToAuthority,
          denemeler:     o.attempts.map((a) => ({
            servis: a.service, altFonksiyon: a.subFunction,
            sonuc: a.outcome, ham: a.raw, kodAdedi: a.codeCount,
          })),
        })),
        tamlik: completeness === null ? null : {
          oturum:          completeness.sessionEpoch,
          bayatOturum:     completeness.staleSession,
          kesfedilen:      completeness.discovered,
          problanan:       completeness.probed,
          taranan:         completeness.scanned,
          atlanan:         completeness.skipped,
          okunamayan:      completeness.failed,
          ulasilamayan:    completeness.notAddressable,
          paydaBiliniyor:  completeness.denominatorKnown,
          kapsamEtiketi:   completeness.completenessLabel,
        },
        /* P0-OBD-FINAL-02: KWP tanı oturumu (0x10) probunun HAM kanıtı. */
        kwpOturumProbu: sessionProbes === null ? null : sessionProbes.map((e) => ({
          oturum: e.sessionEpoch, protokol: e.protocol,
          tx: e.tx, rx: e.rx,
          istek: e.request, pozitifOnek: e.positiveNeedle, hamYanit: e.raw,
          sonuc: e.result, sonucEtiket: KWP_SESSION_RESULT_LABEL[e.result],
          nrc: e.nrc, nativeSonuc: e.nativeOutcome, hata: e.error,
        })),
        /* P0-OBD-DIAG-01: fiziksel adresleme matrisi — hangi header/istek
           GERÇEKTEN cevaplandı. Sahadaki asıl soru buydu. */
        kwpAdreslemeMatrisi: addressing === null ? null : addressing.map((e) => ({
          oturum: e.sessionEpoch, protokol: e.protocol,
          rx: e.rx, header: e.header, varyant: e.variantId, fiziksel: e.physical,
          baslatma: e.initFirst, baslatmaHamYanit: e.initRaw,
          istek: e.request, hamYanit: e.raw,
          sonuc: e.result, sonucEtiket: KWP_ADDRESSING_RESULT_LABEL[e.result],
          nrc: e.nrc, nativeSonuc: e.nativeOutcome, hata: e.error,
        })),
        kwp18Kapisi: kwpGate === null ? null : {
          sonTaramaMs:     kwpGate.lastScanAtMs,
          protokol:        kwpGate.protocolAtScan,
          denendi:         kwpGate.attempted,
          kanalVar:        kwpGate.channelAvailable,
          fizikselHedef:   kwpGate.physicalTarget,
          hedefProvenance: kwpGate.targetProvenance,
          oturumIstegi:    kwpGate.sessionRequest,
          oturumYaniti:    kwpGate.sessionResponse,
          istek18:         kwpGate.request18Tx,
          hamYanit18:      kwpGate.response18Raw,
          kapiSonucu:      kwpGate.gateOutcome,
          gonderilmemeNedeni: kwpGate.notSentReason,
          bulunanKodlar:   [...kwpGate.foundDtcs],
          otoriteYayini:   kwpGate.publishedToCanonicalAuthority,
        },
      } as unknown;
    }),
    /* ── #536 · KOPMA KANIT DEFTERİ (GÖREV A) ───────────────────────────────
       SAHA (2026-08-11): 8 timeout · LinkLost 47 s · quality %57 ölçüldü ama
       KÖK NEDEN ayırt edilemedi (dört aday aynı `timeout` sayısını üretiyor).
       Defter kopma anındaki imzayı + kurtarma imzasını taşır. `records`
       bounded (24) ve PII taşımaz; `summary.nextMeasurement` bir sonraki turun
       ölçüm işini söyler. KİLİT 30 dersi: ölçüm AYNI PR'da kopyaya girer. */
    /* ── D · GPS OTORİTE SÖZLEŞMESİ KOPYAYA GİRER ───────────────────────────
       SAHA (2026-08-30): kopyada `hal.gpsAlive:false` ile
       `connectivity[GPS].connected:true` YAN YANA duruyordu ve `fixAgeMs:null`
       ile `konumFixYasMs:735` çelişki gibi okunuyordu. Üçü FARKLI ekseni ölçüyor
       ama kopya bunu SÖYLEMİYORDU. Ayrışma artık açıklamasız kalmaz.

       ⚠️ Yeni GPS motoru YOK: `gpsHealthReconcile` saf sözleşmesi mevcut sayıları
       kendi adıyla sunar; hesap/karar/I/O üretmez (LAB ikinci otorite olamaz). */
    gpsAuthority: safe(() => {
      const n = readNavigationCoreSnapshot();
      const hal = useHALStatusStore.getState().sourceHealth;
      const conn = getConnectivitySnapshot();
      const gps = conn
        ? (Object.values(conn).find((c) => String(c.source) === 'GPS') ?? null)
        : null;
      const input = {
        connectivityConnected: gps ? gps.connected : null,
        halGpsAlive:           hal ? hal.gpsAlive : null,
        locationFixAgeMs:      n.locationFixAgeMs,
        navFixAgeMs:           n.fixAgeMs,
        fixFreshWindowMs:      GPS_COPY_FIX_FRESH_WINDOW_MS,
      };
      return {
        aciklama: 'GPS "canlı mı" sorusunun ÜÇ AYRI ekseni vardır ve birbirinin '
                + 'yerine KULLANILAMAZ. `hal.gpsAlive` bu eksenlerin hiçbiri değildir '
                + '— worker-yerel füzyon girdisidir (monotonik saat · 5 sn watchdog).',
        tazelikPenceresiMs: GPS_COPY_FIX_FRESH_WINDOW_MS,
        eksenler: describeGpsAuthorities(input),
        ayrisma:  explainGpsAuthorityDivergence(input),
        hamGirdi: input,
      } as unknown;
    }),
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
