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
import { getOBDDataSnapshot } from '../obdService';
import { getReplayData, getCrashDetectionHealth } from '../security/blackBoxService';
import { useHALStatusStore } from '../vehicleDataLayer/halStatusStore';
import { getDevtoolsCaptureStatus } from './devtoolsCapture';
import { getPollEvidenceCacheState } from '../obd/extendedPollEvidence';
import { getErrorLog } from '../crashLogger';
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
  };
}
