/**
 * maviCore/discoveryActions.ts — P0 Deep PID/DID Explorer Faz-1 · Mavi Action Registry KÖPRÜSÜ.
 *
 * `appSafeActions.ts` deseniyle BİREBİR: SAF eylem tanımları (bu dosya) + DI edilebilir
 * `DiscoveryActionPort` + handler fabrikası. Registry/executionEngine'e KAYIT (wiring)
 * BİLEREK YAPILMADI — maviCore/wiring/ ve SystemBoot AKTİF (kirli olmasa da) orkestrasyon
 * yüzeyleri olduğundan, bu PR'ın "yalnız yeni dosya" kapsamını korumak için `registerDiscoveryActions`
 * dışa aktarılır (idempotent DEĞİL — appActionRegistry deseniyle aynı: çift çağrı Error);
 * gerçek wiring (registry.register + executionEngine handlers map'ine ekleme) SONRAKİ PR'a
 * bırakılmıştır (rapora yazılı).
 *
 * GÜVENLİK: hepsi `vehicleScope:'read'` taşır → AiSafetyGate'ten geçer (Faz-1 read-only
 * invaryantı ile hizalı); gate reddederse hiçbir OBD komutu gitmez (evaluateActionSafety
 * araç kapısını UX onayından ÖNCE değerlendirir — actionSafety.ts sözleşmesi).
 */

import {
  validateEmpty, type ActionDefinition,
} from './actionRegistry';
import type { MaviActionRegistry } from './actionRegistry';
import type { ActionHandler, ActionExecResult } from './executionEngine';

export const DISCOVERY_ACTION_START = 'vehicle.discovery.start';
export const DISCOVERY_ACTION_STATUS = 'vehicle.discovery.status';
export const DISCOVERY_ACTION_CANCEL = 'vehicle.discovery.cancel';
export const DISCOVERY_ACTION_RESULTS = 'vehicle.discovery.results';
export const DISCOVERY_ACTION_APPLY_VERIFIED = 'vehicle.discovery.applyVerified';

/**
 * Gerçek koordinatöre (discoveryLive.getLiveDiscoveryCoordinator) DI edilecek port.
 * Handler'lar bu port üzerinden çağrılır — motor/registry servise bağımlı DEĞİLDİR.
 */
export interface DiscoveryActionPort {
  readonly start: () => Promise<{ ok: boolean; value?: unknown; error?: string }>;
  readonly status: () => { ok: boolean; value: unknown };
  readonly cancel: () => { ok: boolean };
  readonly results: () => { ok: boolean; value: unknown };
  readonly applyVerified: () => { ok: boolean; value: unknown };
}

export function buildDiscoveryActionDefinitions(): ActionDefinition[] {
  return [
    {
      id: DISCOVERY_ACTION_START, title: 'Araç PID/DID keşfini başlat', risk: 'low', reversible: false,
      timeoutMs: 20_000, resultContract: 'value', vehicleScope: 'read', validate: validateEmpty,
    },
    {
      id: DISCOVERY_ACTION_STATUS, title: 'Keşif durumunu oku', risk: 'low', reversible: true,
      timeoutMs: 2_000, resultContract: 'value', vehicleScope: 'read', validate: validateEmpty,
    },
    {
      id: DISCOVERY_ACTION_CANCEL, title: 'Keşfi iptal et', risk: 'low', reversible: false,
      timeoutMs: 2_000, resultContract: 'ack', vehicleScope: 'read', validate: validateEmpty,
    },
    {
      id: DISCOVERY_ACTION_RESULTS, title: 'Keşif sonuçlarını oku', risk: 'low', reversible: true,
      timeoutMs: 2_000, resultContract: 'value', vehicleScope: 'read', validate: validateEmpty,
    },
    {
      // medium: sonuçları "canlıya uygula" (kullanıcı onayı ister — UX riski, ECU YAZMAZ).
      id: DISCOVERY_ACTION_APPLY_VERIFIED, title: 'Doğrulanmış verileri canlıya uygula', risk: 'medium', reversible: false,
      timeoutMs: 5_000, resultContract: 'value', vehicleScope: 'read', validate: validateEmpty,
    },
  ];
}

export function buildDiscoveryActionHandlers(port: DiscoveryActionPort): Record<string, ActionHandler> {
  return {
    [DISCOVERY_ACTION_START]: async (): Promise<ActionExecResult> => {
      const r = await port.start();
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error ?? 'start_failed' };
    },
    [DISCOVERY_ACTION_STATUS]: (): ActionExecResult => {
      const r = port.status();
      return { ok: r.ok, value: r.value };
    },
    [DISCOVERY_ACTION_CANCEL]: (): ActionExecResult => {
      const r = port.cancel();
      return { ok: r.ok };
    },
    [DISCOVERY_ACTION_RESULTS]: (): ActionExecResult => {
      const r = port.results();
      return { ok: r.ok, value: r.value };
    },
    [DISCOVERY_ACTION_APPLY_VERIFIED]: (): ActionExecResult => {
      const r = port.applyVerified();
      return { ok: r.ok, value: r.value };
    },
  };
}

/** Eylem tanımlarını verilen deftere kaydet (appActionRegistry deseni — çift çağrı Error). */
export function registerDiscoveryActions(registry: MaviActionRegistry): void {
  for (const def of buildDiscoveryActionDefinitions()) registry.register(def);
}

/** Gerçek koordinatörle DI edilmiş port — discoveryLive.getLiveDiscoveryCoordinator'ı sarar. */
export function buildLiveDiscoveryActionPort(coordinator: {
  start: () => Promise<{ standardPids: unknown[]; didResults: unknown[]; stopReason: string }>;
  status: () => unknown;
  results: () => unknown;
  cancel: () => void;
  applyVerified: () => unknown;
}): DiscoveryActionPort {
  return {
    start: async () => {
      try {
        const value = await coordinator.start();
        return { ok: true, value };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    status: () => ({ ok: true, value: coordinator.status() }),
    cancel: () => { coordinator.cancel(); return { ok: true }; },
    results: () => ({ ok: true, value: coordinator.results() }),
    applyVerified: () => ({ ok: true, value: coordinator.applyVerified() }),
  };
}
