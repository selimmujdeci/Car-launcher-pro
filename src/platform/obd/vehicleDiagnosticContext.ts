/**
 * vehicleDiagnosticContext — P0-VDK-F5G · ARAÇ TANI BAĞLAMININ TEK BAĞLAMA NOKTASI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (bu dosyanın var olma nedeni) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5-F raporunda açık borç olarak yazıldı (#4): araç bağlama "açık kabloydu" —
 * `activateGapLedgerVehicle()` `switched` döndürüyor, çağıran da ayrıca
 * `detachGapResolverForVehicleSwitch()` ve `detachProbeLedgerForVehicleSwitch()`
 * çağırmayı HATIRLAMAK zorundaydı. F5-G ile buna bir de yetenek bölümü
 * eklenince, unutulabilecek adım sayısı dörde çıkıyordu ve unutulan her adım
 * **iki aracın verisinin karışması** demekti.
 *
 * Bu modül o sırayı TEK yerde ve TEK çağrıda toplar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YENİ ARAÇ KİMLİK OTORİTESİ DEĞİLDİR.** Kimlik ve gücü çağırandan
 *     (F4-C `buildCapabilityFingerprint` / `isFingerprintReusable`) gelir;
 *     burada parmak izi ÜRETİLMEZ, güç YENİDEN HESAPLANMAZ.
 * (2) **YENİ KAPSAM POLİTİKASI DEĞİLDİR.** Karar SAF
 *     `gapLedgerScope.resolveGapLedgerScope`tedir ve **TEK KEZ** hesaplanıp
 *     her iki depoya AYNI nesne olarak verilir — iki deponun farklı araca
 *     bakması bu yüzden yapısal olarak imkânsızdır.
 * (3) **DEFTER/DEPO DEĞİLDİR.** Tek satır saklamaz.
 * (4) **BOOT YÖNETİCİSİ DEĞİLDİR.** Ne zaman çağrılacağına üretim yolu
 *     (`productionDiscovery`) karar verir.
 *
 * timer YOK · ağ YOK · `Date.now` ENJEKTE edilir.
 */

import { logError } from '../crashLogger';
import {
  resolveGapLedgerScope, type GapLedgerScope, type GapLedgerScopeInput,
} from './gapLedgerScope';
import { getTraceProvenanceMode, type TraceProvenance } from './canonicalTrace';
import {
  activateGapLedgerVehicle, getGapRegistry, getGapLedgerHealth,
} from './gapRegistry';
import {
  activateCapabilityVehicle, getCapabilityEdges,
} from './capability/capabilityStore';
/* P0-VDK-F6A — ÜÇÜNCÜ araç bölümü: ECU rol öğrenmesi. Ayrı bir bağlama
   çağrısı bırakılsaydı, unutulabilecek adım sayısı yeniden artardı ve
   "roller A'da, yetenek B'de" durumu mümkün olurdu. */
import { activateEcuRoleVehicle, getStoredEcuRoles } from './ecu/ecuRoleStore';
import { detachProbeLedgerForVehicleSwitch }
  from './discovery/serviceDiscoveryRuntime';
import { detachGapResolverForVehicleSwitch } from './healing/gapResolverRuntime';
import { runPartitionGc, touchVehiclePartition } from './vehiclePartitionCatalog';
import type { PartitionGcResult } from './vehiclePartitionCatalog';
import type { PartitionHealth } from './vehiclePartitionPolicy';

export interface VehicleContextInput
  extends Omit<GapLedgerScopeInput, 'traceMode'> {
  readonly nowMs: number | null;
  /** Verilmezse MEVCUT `canonicalTrace` replay modu okunur (tek otorite). */
  readonly traceMode?: TraceProvenance;
}

export interface VehicleContextActivation {
  /** İki deponun da kullandığı TEK kapsam. */
  readonly scope: GapLedgerScope;
  readonly switched: boolean;
  readonly detachedRef: string | null;
  readonly gapEntries: number;
  readonly capabilityEdges: number;
  /** P0-VDK-F6A — bu araç için öğrenilmiş ECU rolü adedi. */
  readonly ecuRoles: number;
  /** Çöp toplama sonucu; koşmadıysa `null`. */
  readonly gc: PartitionGcResult | null;
}

function _healthOf(): PartitionHealth {
  try {
    const h = getGapLedgerHealth();
    if (h === 'CORRUPT' || h === 'SCHEMA_MISMATCH' || h === 'UNAVAILABLE') {
      return 'CORRUPT';
    }
    return 'OK';
  } catch { return 'UNKNOWN'; }
}

/**
 * ARAÇ TANI BAĞLAMINI BAĞLAR — sıra PAZARLIKSIZ ve tek yerdedir.
 *
 *   1. Kapsam TEK KEZ hesaplanır (saf karar).
 *   2. Boşluk sicili bölümü bağlanır.
 *   3. Yetenek öğrenmesi bölümü AYNI kapsamla bağlanır.
 *   4. Araç DEĞİŞTİYSE süreç ömürlü defterler ayrılır (çözüm durumları ·
 *      yoklama defteri) — eski aracın "TÜKENDİ" kararı ve ölçüm kanıtı yeni
 *      araca taşınamaz.
 *   5. Bölüm kataloğu güncellenir (yalnız metadata).
 *   6. Bölüm tavanı aşıldıysa çöp toplama koşar — AKTİF ARAÇ ASLA silinmez.
 *
 * ASLA throw etmez: bağlamanın düşmesi taramayı düşürmez.
 */
export function activateVehicleDiagnosticContext(
  input: VehicleContextInput,
): VehicleContextActivation {
  let scope: GapLedgerScope;
  try {
    scope = resolveGapLedgerScope({
      vehicleRef: input.vehicleRef,
      fingerprintReusable: input.fingerprintReusable,
      provenance: input.provenance,
      traceMode: input.traceMode ?? getTraceProvenanceMode(),
    });
  } catch (e) {
    logError('OBD:VehicleContextScope', e);
    return {
      scope: resolveGapLedgerScope({
        vehicleRef: null, fingerprintReusable: false,
        provenance: null, traceMode: 'live',
      }),
      switched: false, detachedRef: null,
      gapEntries: 0, capabilityEdges: 0, ecuRoles: 0, gc: null,
    };
  }

  let switched = false;
  let detachedRef: string | null = null;

  /* ── 2) BOŞLUK SİCİLİ ─────────────────────────────────────────────────── */
  try {
    const act = activateGapLedgerVehicle({
      vehicleRef: scope.vehicleRef,
      fingerprintReusable: input.fingerprintReusable,
      provenance: input.provenance,
      traceMode: input.traceMode ?? getTraceProvenanceMode(),
      nowMs: input.nowMs,
    });
    switched = act.switched;
    detachedRef = act.detachedRef;
  } catch (e) { logError('OBD:VehicleContextGapLedger', e); }

  /* ── 3) YETENEK ÖĞRENMESİ — AYNI kapsam nesnesi ───────────────────────── */
  try {
    const cap = activateCapabilityVehicle(scope, input.nowMs);
    if (cap.switched) {
      switched = true;
      detachedRef = detachedRef ?? cap.detachedRef;
    }
  } catch (e) { logError('OBD:VehicleContextCapability', e); }

  /* ── 3b) ECU ROL ÖĞRENMESİ — AYNI kapsam nesnesi (P0-VDK-F6A) ─────────── */
  try {
    const roles = activateEcuRoleVehicle(scope, input.nowMs);
    if (roles.switched) {
      switched = true;
      detachedRef = detachedRef ?? roles.detachedRef;
    }
  } catch (e) { logError('OBD:VehicleContextEcuRoles', e); }

  /* ── 4) SÜREÇ ÖMÜRLÜ DEFTERLER — araç değiştiyse AYRILIR ──────────────── */
  if (switched) {
    try { detachGapResolverForVehicleSwitch(); }
    catch (e) { logError('OBD:VehicleContextResolverDetach', e); }
    try { detachProbeLedgerForVehicleSwitch(); }
    catch (e) { logError('OBD:VehicleContextProbeDetach', e); }
  }

  let gapEntries = 0;
  let unresolvedGaps = 0;
  let capabilityEdges = 0;
  let ecuRoles = 0;
  try {
    const rows = getGapRegistry();
    gapEntries = rows.length;
    unresolvedGaps = rows.filter((r) => r.resolutionState !== 'RESOLVED').length;
  } catch (e) { logError('OBD:VehicleContextGapCount', e); }
  try { capabilityEdges = getCapabilityEdges().length; }
  catch (e) { logError('OBD:VehicleContextEdgeCount', e); }
  try { ecuRoles = getStoredEcuRoles().length; }
  catch (e) { logError('OBD:VehicleContextRoleCount', e); }

  /* ── 5) KATALOG — yalnız METADATA (ham kenar/boşluk YOK) ──────────────── */
  let gc: PartitionGcResult | null = null;
  if (scope.persistenceAllowed && scope.vehicleRef !== null) {
    try {
      touchVehiclePartition({
        ref: scope.vehicleRef,
        nowMs: input.nowMs,
        gapEntries,
        unresolvedGaps,
        capabilityEdges,
        health: _healthOf(),
      });
    } catch (e) { logError('OBD:VehicleContextCatalog', e); }

    /* ── 6) ÇÖP TOPLAMA — aktif araç ASLA aday değildir ─────────────────── */
    try { gc = runPartitionGc(scope.vehicleRef, input.nowMs); }
    catch (e) { logError('OBD:VehicleContextGc', e); }
  }

  return { scope, switched, detachedRef, gapEntries, capabilityEdges, ecuRoles, gc };
}
