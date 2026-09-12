/**
 * maviCore/actionSafety.ts — MAVİ ÇEKİRDEĞİ Faz-1 · Eylem güvenlik KÖPRÜSÜ.
 *
 * AMAÇ: Bir eylem YÜRÜTÜLMEDEN ÖNCE tek kapıdan geçirmek. İki ayrı eksen birleşir:
 *
 *   1) ARAÇ/ECU güvenliği → MEVCUT AiSafetyGate'e DELEGE edilir (ikinci otorite KURULMAZ).
 *      Araç-etkili eylemler (vehicle.health.read → 'read') gate'e sorulur; gate hard-forbidden
 *      (ecu_write/coding/actuator/adaptation) veya kapsam-dışı derse → DENY. Araç güvenlik
 *      kararının TEK sahibi AiSafetyGate'tir; bu köprü o kararı yalnız TAŞIR.
 *
 *   2) UX RİSK sınıfı → düşük risk doğrudan izinli; orta/yüksek risk kullanıcı ONAYI ister
 *      (confirmation_required). Bu bir GÜVENLİK kararı değil, deneyim kararıdır (yanlış eylemi
 *      körlemesine uygulamaktansa "bunu mu istedin?" sor) — dolayısıyla ikinci güvenlik
 *      otoritesi doğurmaz.
 *
 * TASARIM (CLAUDE.md · aiCore deseni):
 *  - SAF · FAIL-CLOSED: bilinmeyen/tanımsız eylem → DENY. Bozuk gate/def → DENY. throw ETMEZ.
 *  - Karar zincirinde ÖNCE araç kapısı (delege), SONRA UX risk. Araç reddi UX'i ezmez —
 *    araç DENY her zaman son karardır.
 */

import type { AiSafetyGate } from '../aiCore/safetyGate';
import type { ActionDefinition, ActionRiskLevel } from './actionRegistry';
import type { MaviActionRegistry } from './actionRegistry';

/** Eylem güvenlik kararı sonucu. */
export type ActionSafetyOutcome = 'allow' | 'confirm' | 'deny';

export interface ActionSafetyDecision {
  readonly outcome: ActionSafetyOutcome;
  readonly actionId: string;
  readonly risk: ActionRiskLevel;
  /** Makine-okur gerekçe (ör. 'ok', 'unknown_action', 'vehicle_gate_denied', 'needs_confirmation'). */
  readonly reason: string;
  /** Araç kapsamı varsa AiSafetyGate'in gerekçesi (delege zinciri izlenebilirliği). */
  readonly gateReason?: string;
}

export interface ActionSafetyOpts {
  /**
   * Kullanıcı bu eylemi ZATEN onayladı mı (önceki turda "bunu mu istedin? → evet"). true ise
   * orta/yüksek risk 'confirm' yerine 'allow'a düşer. Araç kapısını (delege) ETKİLEMEZ —
   * kullanıcı onayı ECU yasağını açamaz (fail-closed korunur).
   */
  readonly confirmed?: boolean;
  /** İstek sahibi ajan kimliği (gate log/gerekçe için). Varsayılan 'mavi'. */
  readonly agentId?: string;
}

function deny(actionId: string, risk: ActionRiskLevel, reason: string, gateReason?: string): ActionSafetyDecision {
  return Object.freeze({ outcome: 'deny', actionId, risk, reason, gateReason });
}

/**
 * Bir eylem tanımının güvenlik kararını verir. def undefined ise (bilinmeyen eylem) → DENY.
 *
 * Karar sırası:
 *  1. def yok/bozuk → DENY 'unknown_action'.
 *  2. Araç kapsamı varsa → AiSafetyGate.evaluate; gate DENY → DENY 'vehicle_gate_denied'.
 *  3. UX risk: low → ALLOW; medium/high → confirmed ? ALLOW : CONFIRM.
 */
export function evaluateActionSafety(
  def: ActionDefinition | undefined | null,
  gate: AiSafetyGate,
  opts: ActionSafetyOpts = {},
): ActionSafetyDecision {
  // 1. Bilinmeyen/bozuk eylem → fail-closed.
  if (!def || typeof def.id !== 'string' || typeof def.risk !== 'string') {
    return deny('unknown', 'high', 'unknown_action');
  }

  // 2. Araç/ECU güvenliği → AiSafetyGate'e DELEGE (araç kapsamı olan eylemler için).
  if (def.vehicleScope) {
    if (!gate || typeof gate.evaluate !== 'function') {
      // Gate yoksa araç-etkili eylem güvenle değerlendirilemez → fail-closed.
      return deny(def.id, def.risk, 'vehicle_gate_unavailable');
    }
    const gd = gate.evaluate({
      agentId: opts.agentId ?? 'mavi',
      scope: def.vehicleScope,
      description: def.id,
    });
    if (!gd.allowed) {
      return deny(def.id, def.risk, 'vehicle_gate_denied', gd.reason);
    }
  }

  // 3. UX risk sınıfı (araç kapısı geçildikten sonra).
  if (def.risk === 'low') {
    return Object.freeze({ outcome: 'allow', actionId: def.id, risk: def.risk, reason: 'ok' });
  }
  // medium/high → kullanıcı onayı gerekir (zaten onaylanmadıysa).
  if (opts.confirmed === true) {
    return Object.freeze({ outcome: 'allow', actionId: def.id, risk: def.risk, reason: 'confirmed' });
  }
  return Object.freeze({ outcome: 'confirm', actionId: def.id, risk: def.risk, reason: 'needs_confirmation' });
}

/**
 * Eylem KİMLİĞİNİ defterden çözüp güvenlik kararını verir. Bilinmeyen id → DENY (fail-closed).
 * executionEngine/orchestrator'ın birincil giriş noktası.
 */
export function evaluateActionIdSafety(
  registry: MaviActionRegistry,
  gate: AiSafetyGate,
  actionId: string,
  opts: ActionSafetyOpts = {},
): ActionSafetyDecision {
  const def = registry && typeof registry.get === 'function' ? registry.get(actionId) : undefined;
  if (!def) return deny(typeof actionId === 'string' ? actionId : 'unknown', 'high', 'unknown_action');
  return evaluateActionSafety(def, gate, opts);
}
