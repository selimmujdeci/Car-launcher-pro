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
import { getReplayData } from '../security/blackBoxService';
import { useHALStatusStore } from '../vehicleDataLayer/halStatusStore';
import { getDevtoolsCaptureStatus } from './devtoolsCapture';
import type { CarosLabCopyInput } from './carosLabCopyModel';

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
    errorLog:   safe(() => useDebugStore.getState().errorLog as readonly unknown[]),
    /* HAL kaynak sağlığı: `canAlive/obdAlive/gpsAlive` — **null = BİLİNMİYOR**, false = ÖLÜ.
       `updatedAt` worker MONOTONİK saatidir (performance.now()), duvar saati DEĞİL →
       `Date.now()` ile bayatlık hesaplamak YANLIŞ olur; ham geçirilir, yorumlanmaz. */
    sourceHealth: safe(() => useHALStatusStore.getState().sourceHealth as unknown),
  };
}
