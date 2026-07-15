/**
 * extendedPollEvidence — PR-OBD-DIAG-3: native EXTENDED PID poll kanıtı + JS akış
 * sayaçlarını birleştirip H1/H2/H3/H4 KESİN HÜKMÜNÜ üretir (saf, test edilebilir).
 *
 * KÖK PROBLEM: {@code obdDeep.extended.samples: []} üç farklı arızayı ayıramıyordu.
 * Bu modül native sayaçları (attempted/success/callbackEmitted…) ile JS sayaçlarını
 * (eventsReceived/valuesStored) yan yana koyar → tek raporla neyin nerede koptuğu belli.
 *
 *   H1  configured>0 & attempted=0            → POLL ÇALIŞMADI (burst/poll wiring)
 *   H2  attempted>0 & success=0 & callback=0  → POLL ÇALIŞTI, ECU DEĞER ÜRETMEDİ
 *   H3  success>0 & callback>0 & stored=0     → NATIVE→JS/STORE HATTI (köprü ya da decode)
 *   H4  success>0 & callback>0 & stored>0     → HAT SAĞLIKLI
 *
 * Native çağrı ASYNC (plugin) → {@link refreshExtendedPollEvidence} önce await edilir,
 * sonra {@link getExtendedPollEvidence} senkron okunur (buildObdDeepSnapshot senkron).
 * Fail-soft: eski APK / hata → kanıt yok (NO_NATIVE_EVIDENCE), rapor yine döner.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher, type NativeExtendedPollEvidence } from '../nativePlugin';
import { getExtendedJsCounters } from './extendedPidService';

export type ExtendedPollDecisionCode =
  | 'NO_NATIVE_EVIDENCE'  // eski APK / plugin metodu yok
  | 'NO_PIDS'             // hiç extended PID yapılandırılmadı (panel kapalı / keşif boş)
  | 'H1_POLL_DEAD'        // liste var, hiç denenmedi
  | 'H2_ECU_SILENT'       // denendi, değer yok
  | 'H3_BRIDGE_GAP'       // native başarılı+callback ama JS olayı gelmedi (köprü)
  | 'H3_DECODE_GAP'       // JS olayı geldi ama değer saklanmadı (decode)
  | 'H4_HEALTHY'          // uçtan uca akıyor
  | 'UNKNOWN';            // sayaçlar tutarsız

export interface ExtendedPollDecision {
  code: ExtendedPollDecisionCode;
  label: string;
}

export interface ExtendedJsCounters {
  eventsReceived: number; decodeFailures: number; valuesStored: number; valuesCached: number;
}

export interface ExtendedPollEvidenceSnapshot {
  present: boolean;
  transport: string;
  burstEnabled: boolean;
  configuredPidCount: number;
  configuredPidPreview: string[];
  counters: NativeExtendedPollEvidence['counters'] | null;
  lastAttempts: NativeExtendedPollEvidence['lastAttempts'];
  js: ExtendedJsCounters;
  decision: ExtendedPollDecision;
  /** Kanıt eksiksiz mi — hüküm çıkarmak için native sayaçlar mevcut ve tutarlı. */
  evidenceComplete: boolean;
}

let _cached: NativeExtendedPollEvidence | null = null;

/** Native kanıtı tazele (async plugin çağrısı) — rapor derlemeden önce await edilir. */
export async function refreshExtendedPollEvidence(): Promise<void> {
  // Web/test veya eski APK: metot yok → kanıt yok (fail-soft).
  if (!Capacitor.isNativePlatform() || !CarLauncher.getObdExtendedPollEvidence) {
    _cached = null;
    return;
  }
  try {
    const ev = await CarLauncher.getObdExtendedPollEvidence();
    _cached = ev && typeof ev === 'object' ? ev : null;
  } catch {
    _cached = null; // köprü hatası → kanıt yok
  }
}

/**
 * Saf karar fonksiyonu — native + JS sayaçlardan H1/H2/H3/H4 hükmü. Test edilebilir
 * (acceptance §11 birebir). Kanıt yoksa NO_NATIVE_EVIDENCE; yapılandırma yoksa NO_PIDS.
 */
export function classifyExtendedPoll(
  native: NativeExtendedPollEvidence | null,
  js: ExtendedJsCounters,
): ExtendedPollDecision {
  if (!native || !native.present) {
    return { code: 'NO_NATIVE_EVIDENCE', label: 'Kanıt mevcut değil (eski APK / poll başlamadı)' };
  }
  const c = native.counters;
  if (native.configuredPidCount === 0 && c.attempted === 0) {
    return { code: 'NO_PIDS', label: 'Yapılandırılan extended PID yok — panel açılmadı / keşif boş' };
  }
  if (c.attempted === 0) {
    return { code: 'H1_POLL_DEAD', label: 'POLL ÇALIŞMADI — burst/poll wiring tetiklenmedi' };
  }
  if (c.success === 0 && c.callbackEmitted === 0) {
    return { code: 'H2_ECU_SILENT', label: 'POLL ÇALIŞTI, ECU DEĞER ÜRETMEDİ (NO_DATA/timeout/negatif)' };
  }
  if (c.callbackEmitted > 0 && js.valuesStored === 0) {
    if (js.eventsReceived === 0) {
      return { code: 'H3_BRIDGE_GAP', label: 'NATIVE BAŞARILI ama JS OLAY GELMEDİ — native→JS köprü hattı' };
    }
    return { code: 'H3_DECODE_GAP', label: 'JS OLAY GELDİ ama DEĞER SAKLANMADI — decode/registry hattı' };
  }
  if (c.success > 0 && c.callbackEmitted > 0 && js.valuesStored > 0) {
    return { code: 'H4_HEALTHY', label: 'HAT SAĞLIKLI — native→JS→store uçtan uca akıyor' };
  }
  return { code: 'UNKNOWN', label: 'Belirsiz — sayaçlar tutarsız (kanıt eksik)' };
}

/** Senkron birleşik kanıt — buildObdDeepSnapshot bunu gömer. */
export function getExtendedPollEvidence(): ExtendedPollEvidenceSnapshot {
  const js = getExtendedJsCounters();
  const native = _cached;
  const decision = classifyExtendedPoll(native, js);
  const present = !!(native && native.present);
  return {
    present,
    transport: native?.transport ?? 'unknown',
    burstEnabled: native?.burstEnabled ?? false,
    configuredPidCount: native?.configuredPidCount ?? 0,
    configuredPidPreview: native?.configuredPidPreview ?? [],
    counters: native?.counters ?? null,
    lastAttempts: native?.lastAttempts ?? [],
    js,
    decision,
    // Hüküm ancak native sayaçlar mevcut + tutarlı ise "tam"dır.
    evidenceComplete: present && (native?.coherent ?? false),
  };
}

/** Test yardımcıları — üretim kodu çağırmaz. */
export const _internals = {
  reset(): void { _cached = null; },
  setCached(ev: NativeExtendedPollEvidence | null): void { _cached = ev; },
};
